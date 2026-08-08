import path from "node:path";
import { parse } from "yaml";
import { displayPath, fingerprint, listSkillFiles, readText } from "../files.js";
import type { SkillEvidence, StaticFinding, SurfaceKind, SurfaceScope } from "../types.js";
import type { InternalSurface } from "./types.js";

export function inspectFile({
  filePath,
  projectRoot,
  homeDirectory,
  kind,
  scope,
  reason,
  order,
  importedBy,
  transform,
}: {
  filePath: string;
  projectRoot: string;
  homeDirectory: string;
  kind: SurfaceKind;
  scope: SurfaceScope;
  reason: string;
  order?: number;
  importedBy?: string;
  transform?: (content: string) => string;
}): { surface?: InternalSurface; finding?: StaticFinding } {
  const display = displayPath(filePath, projectRoot, homeDirectory);
  const result = readText(filePath);
  if (result.kind === "missing") return {};
  if (result.kind === "unreadable") {
    return {
      surface: {
        absolutePath: filePath,
        displayPath: display,
        kind,
        scope,
        disposition: "unreadable",
        reason: result.error ?? "file could not be read",
        ...(importedBy === undefined ? {} : { importedBy }),
      },
      finding: {
        code: "unreadable-surface",
        severity: "warning",
        message: `Could not read ${display}`,
        path: display,
      },
    };
  }
  const source = result.content ?? "";
  const content = transform ? transform(source) : source;
  return {
    surface: {
      absolutePath: filePath,
      displayPath: display,
      kind,
      scope,
      disposition: content.trim() ? "applied" : "ignored",
      ...(order === undefined ? {} : { order }),
      content,
      bytes: Buffer.byteLength(content),
      fingerprint: fingerprint(content),
      reason: content.trim() ? reason : "empty files are not loaded",
      ...(importedBy === undefined ? {} : { importedBy }),
    },
  };
}

function parseFrontmatter(content: string): Record<string, unknown> | undefined {
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

export function inspectSkillDirectory({
  directoryPath,
  scope,
  projectRoot,
  homeDirectory,
}: {
  directoryPath: string;
  scope: SurfaceScope;
  projectRoot: string;
  homeDirectory: string;
}): { skills: SkillEvidence[]; findings: StaticFinding[] } {
  const skills: SkillEvidence[] = [];
  const findings: StaticFinding[] = [];
  for (const skillPath of listSkillFiles(directoryPath)) {
    const display = displayPath(skillPath, projectRoot, homeDirectory);
    const result = readText(skillPath);
    if (result.kind !== "ok") {
      skills.push({
        name: path.basename(path.dirname(skillPath)),
        path: display,
        scope,
        disposition: "unreadable",
        reason: "SKILL.md could not be read",
      });
      findings.push({
        code: "unreadable-skill",
        severity: "warning",
        message: `Could not read ${display}`,
        path: display,
      });
      continue;
    }
    const metadata = parseFrontmatter(result.content ?? "");
    const declaredName = metadata?.name;
    const name =
      typeof declaredName === "string" && declaredName.trim()
        ? declaredName.trim()
        : path.basename(path.dirname(skillPath));
    skills.push({
      name,
      path: display,
      scope,
      disposition: "available",
      reason: `${scope} Agent Skill discovered at startup`,
    });
  }
  return { skills, findings };
}

export function sortSurfaces(surfaces: InternalSurface[]): InternalSurface[] {
  return surfaces.sort((left, right) => {
    const order = (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
    if (order) return order;
    return left.displayPath.localeCompare(right.displayPath);
  });
}

export function sortSkills(skills: SkillEvidence[]): SkillEvidence[] {
  return skills.sort(
    (left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
  );
}

