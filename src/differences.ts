import type {
  AgentId,
  ContextScope,
  CrossAgentDifference,
  SurfaceScope,
  TargetInspection,
} from "./types.js";

function scopeMatches(surfaceScope: SurfaceScope, view: ContextScope): boolean {
  if (view === "all") return true;
  const group = surfaceScope === "managed" || surfaceScope === "user" ? "user" : "project";
  return group === view;
}

export function buildDifferences(
  inspections: readonly TargetInspection[],
  view: ContextScope = "all",
): CrossAgentDifference[] {
  if (inspections.length < 2) return [];
  const differences: CrossAgentDifference[] = [];
  const targets = inspections.map((inspection) => inspection.target);

  const fingerprints = new Map<string, Array<{ target: AgentId; path: string }>>();
  for (const inspection of inspections) {
    for (const surface of inspection.surfaces) {
      if (
        surface.disposition !== "applied" ||
        !surface.fingerprint ||
        !scopeMatches(surface.scope, view)
      ) {
        continue;
      }
      const entries = fingerprints.get(surface.fingerprint) ?? [];
      entries.push({ target: inspection.target, path: surface.path });
      fingerprints.set(surface.fingerprint, entries);
    }
  }
  for (const entries of fingerprints.values()) {
    const presentIn = [...new Set(entries.map((entry) => entry.target))];
    const missingFrom = targets.filter((target) => !presentIn.includes(target));
    if (!missingFrom.length) continue;
    differences.push({
      kind: "surface",
      item: entries[0]!.path,
      presentIn,
      missingFrom,
    });
  }

  const skillNames = new Set(
    inspections.flatMap((inspection) =>
      inspection.skills
        .filter(
          (skill) => skill.disposition === "available" && scopeMatches(skill.scope, view),
        )
        .map((skill) => skill.name),
    ),
  );
  for (const name of [...skillNames].sort()) {
    const presentIn = inspections
      .filter((inspection) =>
        inspection.skills.some(
          (skill) =>
            skill.name === name &&
            skill.disposition === "available" &&
            scopeMatches(skill.scope, view),
        ),
      )
      .map((inspection) => inspection.target);
    const missingFrom = targets.filter((target) => !presentIn.includes(target));
    if (missingFrom.length) differences.push({ kind: "skill", item: name, presentIn, missingFrom });
  }

  const kindOrder: Record<CrossAgentDifference["kind"], number> = { surface: 0, skill: 1 };
  return differences.sort(
    (left, right) => kindOrder[left.kind] - kindOrder[right.kind] || left.item.localeCompare(right.item),
  );
}

export function evidenceInScope(surfaceScope: SurfaceScope, view: ContextScope): boolean {
  return scopeMatches(surfaceScope, view);
}
