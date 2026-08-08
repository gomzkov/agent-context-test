import path from "node:path";
import { parse } from "yaml";
import {
  ancestorChain,
  displayPath,
  findGitRoot,
  fingerprint,
  globMatches,
  listMarkdownFiles,
  pathChain,
  readText,
} from "../files.js";
import type { SkillEvidence, StaticFinding, SurfaceScope } from "../types.js";
import { inspectFile, inspectSkillDirectory, sortSkills, sortSurfaces } from "./common.js";
import type {
  ContextHostAdapter,
  HostInspection,
  HostInspectionRequest,
  InternalSurface,
} from "./types.js";

interface ClaudeSettings {
  excludes: string[];
  managedInstructions: Array<{ path: string; content: string }>;
  warnings: string[];
}

function stripBlockComments(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let fenced = false;
  let inComment = false;
  const output: string[] = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      output.push(line);
      continue;
    }
    if (fenced) {
      output.push(line);
      continue;
    }
    let current = line;
    if (inComment) {
      const end = current.indexOf("-->");
      if (end < 0) continue;
      current = current.slice(end + 3);
      inComment = false;
    }
    while (true) {
      const start = current.indexOf("<!--");
      if (start < 0) break;
      const end = current.indexOf("-->", start + 4);
      if (end < 0) {
        current = current.slice(0, start);
        inComment = true;
        break;
      }
      current = current.slice(0, start) + current.slice(end + 3);
    }
    output.push(current);
  }
  return output.join("\n");
}

function frontmatter(content: string): Record<string, unknown> | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match?.[1]) return undefined;
  try {
    const value = parse(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseSettings(files: readonly string[]): ClaudeSettings {
  const result: ClaudeSettings = { excludes: [], managedInstructions: [], warnings: [] };
  for (const filePath of files) {
    const source = readText(filePath);
    if (source.kind === "missing") continue;
    if (source.kind === "unreadable") {
      result.warnings.push(`could not read ${filePath}`);
      continue;
    }
    try {
      const value = JSON.parse(source.content ?? "") as Record<string, unknown>;
      if (Array.isArray(value.claudeMdExcludes)) {
        result.excludes.push(
          ...value.claudeMdExcludes.filter((entry): entry is string => typeof entry === "string"),
        );
      }
      if (typeof value.claudeMd === "string" && value.claudeMd.trim()) {
        result.managedInstructions.push({ path: `${filePath}#claudeMd`, content: value.claudeMd });
      }
    } catch {
      result.warnings.push(`could not parse ${filePath}`);
    }
  }
  return result;
}

function isExcluded(filePath: string, patterns: readonly string[]): boolean {
  const absolute = path.resolve(filePath).replace(/\\/g, "/");
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/\\/g, "/");
    return globMatches(normalized, absolute) || globMatches(normalized, absolute.replace(/^\//, ""));
  });
}

function stripCodeForImports(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let fenced = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return "";
      }
      if (fenced) return "";
      return line.replace(/`[^`]*`/g, "");
    })
    .join("\n");
}

function extractImports(content: string): string[] {
  const source = stripCodeForImports(content);
  const imports: string[] = [];
  const pattern = /(^|[\s(])@([~./A-Za-z0-9_-][^\s`),;]*)/gm;
  for (const match of source.matchAll(pattern)) {
    const value = match[2]?.replace(/[.:]+$/, "");
    if (value && !value.includes("@")) imports.push(value);
  }
  return [...new Set(imports)];
}

function resolveImport(sourcePath: string, importedPath: string, homeDirectory: string): string {
  if (importedPath === "~") return homeDirectory;
  if (importedPath.startsWith("~/")) return path.join(homeDirectory, importedPath.slice(2));
  if (path.isAbsolute(importedPath)) return importedPath;
  return path.resolve(path.dirname(sourcePath), importedPath);
}

function claudeProjectKey(projectRoot: string): string {
  return path.resolve(projectRoot).replace(/[^A-Za-z0-9_-]/g, "-");
}

function truncateMemory(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n").slice(0, 200).join("\n");
  const buffer = Buffer.from(lines);
  return buffer.byteLength <= 25 * 1024 ? lines : buffer.subarray(0, 25 * 1024).toString("utf8");
}

export class ClaudeContextAdapter implements ContextHostAdapter {
  readonly target = "claude" as const;

  inspect(request: HostInspectionRequest): HostInspection {
    const { projectRoot, homeDirectory } = request;
    const gitRoot = findGitRoot(projectRoot) ?? projectRoot;
    const managedRoot =
      process.platform === "darwin"
        ? "/Library/Application Support/ClaudeCode"
        : process.platform === "win32"
          ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "ClaudeCode")
          : "/etc/claude-code";
    const settingsFiles = [
      path.join(managedRoot, "managed-settings.json"),
      path.join(homeDirectory, ".claude", "settings.json"),
      path.join(gitRoot, ".claude", "settings.json"),
      path.join(gitRoot, ".claude", "settings.local.json"),
    ];
    const settings = parseSettings(settingsFiles);
    const findings: StaticFinding[] = settings.warnings.map((message) => ({
      code: "claude-settings-partial",
      severity: "warning",
      message,
      target: "claude",
    }));
    const surfaces: InternalSurface[] = [];
    let order = 0;

    const addFile = (
      filePath: string,
      scope: SurfaceScope,
      kind: "instruction" | "rule" | "memory" = "instruction",
      reason = `${scope} Claude instruction file`,
    ): InternalSurface | undefined => {
      const inspected = inspectFile({
        filePath,
        projectRoot: gitRoot,
        homeDirectory,
        kind,
        scope,
        reason,
        ...(kind === "instruction" ? { transform: stripBlockComments } : {}),
      });
      if (!inspected.surface) return undefined;
      const surface = inspected.surface;
      if (inspected.finding) findings.push({ ...inspected.finding, target: "claude" });
      if (isExcluded(filePath, settings.excludes) && scope !== "managed") {
        surface.disposition = "ignored";
        surface.reason = "excluded by claudeMdExcludes";
      }
      if (surface.disposition === "applied") surface.order = order++;
      surfaces.push(surface);
      return surface;
    };

    addFile(path.join(managedRoot, "CLAUDE.md"), "managed");
    for (const managed of settings.managedInstructions) {
      surfaces.push({
        absolutePath: managed.path,
        displayPath: displayPath(managed.path.replace(/#claudeMd$/, ""), gitRoot, homeDirectory) + "#claudeMd",
        kind: "instruction",
        scope: "managed",
        disposition: "applied",
        order: order++,
        content: managed.content,
        bytes: Buffer.byteLength(managed.content),
        fingerprint: fingerprint(managed.content),
        reason: "managed claudeMd setting",
      });
    }
    const userClaude = addFile(path.join(homeDirectory, ".claude", "CLAUDE.md"), "user");

    const projectDirectories = pathChain(gitRoot, projectRoot);
    for (const directory of ancestorChain(projectRoot)) {
      const insideProject = projectDirectories.includes(directory);
      const scope: SurfaceScope = insideProject
        ? directory === gitRoot
          ? "project"
          : "nested"
        : "project";
      addFile(path.join(directory, "CLAUDE.md"), scope);
      addFile(path.join(directory, "CLAUDE.local.md"), scope);
      if (insideProject) addFile(path.join(directory, ".claude", "CLAUDE.md"), scope);
    }

    const addRuleDirectory = (directory: string, scope: SurfaceScope): void => {
      for (const rulePath of listMarkdownFiles(directory)) {
        const surface = addFile(rulePath, scope, "rule", `${scope} Claude rule`);
        if (!surface || surface.disposition !== "applied") continue;
        const metadata = frontmatter(surface.content ?? "");
        if (metadata?.paths !== undefined) {
          surface.disposition = "available";
          surface.reason = "path-scoped rule; applicability depends on files touched during the task";
          findings.push({
            code: "conditional-rule",
            severity: "info",
            message: `${surface.displayPath} is path-scoped and loads only when matching files are used`,
            target: "claude",
            path: surface.displayPath,
          });
        }
      }
    };
    addRuleDirectory(path.join(homeDirectory, ".claude", "rules"), "user");
    for (const directory of projectDirectories) {
      addRuleDirectory(
        path.join(directory, ".claude", "rules"),
        directory === gitRoot ? "project" : "nested",
      );
    }

    const memoryPath = path.join(
      homeDirectory,
      ".claude",
      "projects",
      claudeProjectKey(gitRoot),
      "memory",
      "MEMORY.md",
    );
    const memory = addFile(memoryPath, "user", "memory", "Claude auto memory loaded at session start");
    if (memory?.content !== undefined) {
      memory.content = truncateMemory(memory.content);
      memory.bytes = Buffer.byteLength(memory.content);
      memory.fingerprint = fingerprint(memory.content);
      memory.reason = "first 200 lines or 25KB of Claude auto memory";
    }

    const importRoots = surfaces.filter(
      (surface) =>
        surface.disposition === "applied" &&
        (surface.kind === "instruction" || surface.kind === "rule") &&
        surface.content,
    );
    const importedPaths = new Set<string>();
    const addImports = (source: InternalSurface, depth: number, stack: readonly string[]): void => {
      if (depth > 4 || !source.content) return;
      for (const importedValue of extractImports(source.content)) {
        const importedPath = resolveImport(source.absolutePath, importedValue, homeDirectory);
        const display = displayPath(importedPath, gitRoot, homeDirectory);
        if (stack.includes(importedPath)) {
          findings.push({
            code: "import-cycle",
            severity: "warning",
            message: `Claude import cycle reaches ${display}`,
            target: "claude",
            path: display,
          });
          continue;
        }
        if (importedPaths.has(importedPath)) continue;
        importedPaths.add(importedPath);
        const inspected = inspectFile({
          filePath: importedPath,
          projectRoot: gitRoot,
          homeDirectory,
          kind: "import",
          scope: source.scope,
          reason: `imported by ${source.displayPath}`,
          importedBy: source.displayPath,
          transform: stripBlockComments,
        });
        if (!inspected.surface) {
          findings.push({
            code: "broken-import",
            severity: "warning",
            message: `${source.displayPath} imports missing ${display}`,
            target: "claude",
            path: display,
          });
          continue;
        }
        const imported = inspected.surface;
        if (inspected.finding) findings.push({ ...inspected.finding, target: "claude" });
        const outsideProject = path.relative(gitRoot, importedPath).startsWith("..");
        if (outsideProject && source.scope !== "user" && source.scope !== "managed") {
          imported.disposition = "available";
          imported.reason = `external import from ${source.displayPath}; runtime approval state is unknown`;
          findings.push({
            code: "external-import-approval",
            severity: "info",
            message: `${source.displayPath} imports external ${display}; Claude may require approval`,
            target: "claude",
            path: display,
          });
        } else if (imported.disposition === "applied") imported.order = order++;
        surfaces.push(imported);
        if (imported.disposition === "applied") addImports(imported, depth + 1, [...stack, importedPath]);
      }
    };
    for (const source of importRoots) addImports(source, 1, [source.absolutePath]);
    if (userClaude) addImports(userClaude, 1, [userClaude.absolutePath]);

    const skills: SkillEvidence[] = [];
    const addSkills = (directory: string, scope: SurfaceScope): void => {
      const inspected = inspectSkillDirectory({
        directoryPath: directory,
        scope,
        projectRoot: gitRoot,
        homeDirectory,
      });
      skills.push(...inspected.skills);
      findings.push(...inspected.findings.map((finding) => ({ ...finding, target: "claude" as const })));
    };
    addSkills(path.join(homeDirectory, ".claude", "skills"), "user");
    for (const directory of projectDirectories) {
      addSkills(
        path.join(directory, ".claude", "skills"),
        directory === gitRoot ? "project" : "nested",
      );
    }
    const addCommands = (directory: string, scope: SurfaceScope): void => {
      for (const commandPath of listMarkdownFiles(directory)) {
        const display = displayPath(commandPath, gitRoot, homeDirectory);
        skills.push({
          name: path.basename(commandPath, ".md"),
          path: display,
          scope,
          disposition: "available",
          reason: "legacy Claude command available as a skill",
        });
      }
    };
    addCommands(path.join(homeDirectory, ".claude", "commands"), "user");
    for (const directory of projectDirectories) {
      addCommands(
        path.join(directory, ".claude", "commands"),
        directory === gitRoot ? "project" : "nested",
      );
    }

    const personalNames = new Set(
      skills.filter((skill) => skill.scope === "user" && skill.disposition === "available").map((skill) => skill.name),
    );
    for (const skill of skills) {
      if (skill.scope !== "user" && personalNames.has(skill.name)) {
        skill.disposition = "shadowed";
        skill.reason = "a personal Claude skill with the same name takes precedence";
      }
    }

    findings.push({
      code: "runtime-context-outside-static-scan",
      severity: "info",
      message: "Runtime flags, plugins, hooks, MCP responses, added directories, prompts, and bundled skills are outside this static scan",
      target: "claude",
    });

    return {
      target: "claude",
      completeness:
        settings.warnings.length || findings.some((finding) => finding.code === "unreadable-surface")
          ? "partial"
          : "complete",
      surfaces: sortSurfaces(surfaces),
      skills: sortSkills(skills),
      findings,
    };
  }
}
