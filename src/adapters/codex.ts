import path from "node:path";
import { displayPath, findGitRoot, pathChain, readText } from "../files.js";
import type { SkillEvidence, StaticFinding } from "../types.js";
import { inspectFile, inspectSkillDirectory, sortSkills, sortSurfaces } from "./common.js";
import type {
  ContextHostAdapter,
  HostInspection,
  HostInspectionRequest,
  InternalSurface,
} from "./types.js";

interface CodexConfig {
  fallbackFilenames: string[];
  maxBytes: number;
  disabledSkills: string[];
  warnings: string[];
}

function parseCodexConfig(configPath: string): CodexConfig {
  const result: CodexConfig = {
    fallbackFilenames: [],
    maxBytes: 32 * 1024,
    disabledSkills: [],
    warnings: [],
  };
  const source = readText(configPath);
  if (source.kind !== "ok") {
    if (source.kind === "unreadable") result.warnings.push(`could not read ${configPath}`);
    return result;
  }
  const content = source.content ?? "";
  const fallbacks = content.match(/^\s*project_doc_fallback_filenames\s*=\s*\[([\s\S]*?)\]/m);
  if (fallbacks?.[1]) {
    const values = [...fallbacks[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!);
    if (values.length) result.fallbackFilenames = values;
    else result.warnings.push("project_doc_fallback_filenames could not be parsed");
  }
  const maxBytes = content.match(/^\s*project_doc_max_bytes\s*=\s*(\d+)/m);
  if (maxBytes?.[1]) {
    const value = Number(maxBytes[1]);
    if (Number.isSafeInteger(value) && value > 0) result.maxBytes = value;
    else result.warnings.push("project_doc_max_bytes is not a positive integer");
  }

  const skillBlocks = content.split(/(?=\[\[skills\.config\]\])/g);
  for (const block of skillBlocks) {
    if (!block.startsWith("[[skills.config]]")) continue;
    const configuredPath = block.match(/^path\s*=\s*["']([^"']+)["']/m)?.[1];
    const enabled = block.match(/^enabled\s*=\s*(true|false)/m)?.[1];
    if (configuredPath && enabled === "false") result.disabledSkills.push(configuredPath);
  }
  return result;
}

function resolveConfiguredPath(configuredPath: string, homeDirectory: string): string {
  if (configuredPath === "~") return homeDirectory;
  if (configuredPath.startsWith("~/")) return path.join(homeDirectory, configuredPath.slice(2));
  return path.resolve(configuredPath);
}

export class CodexContextAdapter implements ContextHostAdapter {
  readonly target = "codex" as const;

  inspect(request: HostInspectionRequest): HostInspection {
    const { projectRoot, homeDirectory, environment } = request;
    const gitRoot = findGitRoot(projectRoot) ?? projectRoot;
    const codexHome = environment.CODEX_HOME
      ? path.resolve(environment.CODEX_HOME)
      : path.join(homeDirectory, ".codex");
    const configPath = path.join(codexHome, "config.toml");
    const config = parseCodexConfig(configPath);
    const findings: StaticFinding[] = config.warnings.map((message) => ({
      code: "codex-config-partial",
      severity: "warning",
      message,
      target: "codex",
      path: displayPath(configPath, gitRoot, homeDirectory),
    }));
    const surfaces: InternalSurface[] = [];
    let totalBytes = 0;
    let order = 0;

    const addCandidateGroup = (
      directory: string,
      filenames: readonly string[],
      scope: "user" | "project" | "nested",
    ): void => {
      let chosen = false;
      for (const filename of filenames) {
        const filePath = path.join(directory, filename);
        const inspected = inspectFile({
          filePath,
          projectRoot: gitRoot,
          homeDirectory,
          kind: "instruction",
          scope,
          reason: `${scope} Codex instruction file`,
        });
        if (!inspected.surface) continue;
        const surface = inspected.surface;
        if (inspected.finding) findings.push({ ...inspected.finding, target: "codex" });
        if (surface.disposition === "unreadable" || surface.disposition === "ignored") {
          surfaces.push(surface);
          continue;
        }
        if (chosen) {
          surface.disposition = "shadowed";
          surface.reason = `a higher-priority instruction filename was selected in ${displayPath(directory, gitRoot, homeDirectory)}`;
          surfaces.push(surface);
          continue;
        }
        chosen = true;
        const bytes = surface.bytes ?? 0;
        if (totalBytes + bytes > config.maxBytes) {
          surface.disposition = "ignored";
          surface.reason = `instruction chain reached project_doc_max_bytes (${config.maxBytes})`;
          findings.push({
            code: "codex-instruction-limit",
            severity: "warning",
            message: `${surface.displayPath} is beyond Codex's configured instruction byte limit`,
            target: "codex",
            path: surface.displayPath,
          });
        } else {
          surface.order = order++;
          totalBytes += bytes;
        }
        surfaces.push(surface);
      }
    };

    addCandidateGroup(codexHome, ["AGENTS.override.md", "AGENTS.md"], "user");

    for (const directory of pathChain(gitRoot, projectRoot)) {
      addCandidateGroup(
        directory,
        ["AGENTS.override.md", "AGENTS.md", ...config.fallbackFilenames],
        directory === gitRoot ? "project" : "nested",
      );
    }

    const skills: SkillEvidence[] = [];
    const skillDirectories: Array<{ path: string; scope: "managed" | "user" | "project" | "nested" }> = [
      { path: "/etc/codex/skills", scope: "managed" },
      { path: path.join(homeDirectory, ".agents", "skills"), scope: "user" },
      ...pathChain(gitRoot, projectRoot).map((directory) => ({
        path: path.join(directory, ".agents", "skills"),
        scope: (directory === gitRoot ? "project" : "nested") as "project" | "nested",
      })),
    ];
    for (const directory of skillDirectories) {
      const inspected = inspectSkillDirectory({
        directoryPath: directory.path,
        scope: directory.scope,
        projectRoot: gitRoot,
        homeDirectory,
      });
      skills.push(...inspected.skills);
      findings.push(...inspected.findings.map((finding) => ({ ...finding, target: "codex" as const })));
    }

    const disabled = new Set(
      config.disabledSkills.map((configuredPath) =>
        displayPath(resolveConfiguredPath(configuredPath, homeDirectory), gitRoot, homeDirectory),
      ),
    );
    for (const skill of skills) {
      if (disabled.has(skill.path)) {
        skill.disposition = "ignored";
        skill.reason = "disabled in Codex config.toml";
      }
    }

    findings.push({
      code: "runtime-context-outside-static-scan",
      severity: "info",
      message: "Plugins, hooks, MCP responses, prompts, and bundled system skills are outside this static scan",
      target: "codex",
    });

    return {
      target: "codex",
      completeness: config.warnings.length ? "partial" : "complete",
      surfaces: sortSurfaces(surfaces),
      skills: sortSkills(skills),
      findings,
    };
  }
}
