import fs from "node:fs";
import path from "node:path";
import { ClaudeContextAdapter } from "./adapters/claude.js";
import { CodexContextAdapter } from "./adapters/codex.js";
import type { ContextHostAdapter, HostInspection, InternalSurface } from "./adapters/types.js";
import { loadContract } from "./contract.js";
import { buildDifferences } from "./differences.js";
import { findNormalizedLine, globMatches, isDirectory } from "./files.js";
import type {
  AgentId,
  ContextAssertion,
  ContextTestRequest,
  ContextTrace,
  DiagnoseResult,
  Diagnosis,
  SkillEvidence,
  StaticEvidence,
  StaticFinding,
  SurfaceEvidence,
  TargetInspection,
} from "./types.js";

const DEFAULT_TARGETS: readonly AgentId[] = ["codex", "claude"];

function publicSurface(surface: InternalSurface): SurfaceEvidence {
  return {
    path: surface.displayPath,
    kind: surface.kind,
    scope: surface.scope,
    disposition: surface.disposition,
    ...(surface.order === undefined ? {} : { order: surface.order }),
    ...(surface.bytes === undefined ? {} : { bytes: surface.bytes }),
    ...(surface.fingerprint === undefined ? {} : { fingerprint: surface.fingerprint }),
    reason: surface.reason,
    ...(surface.importedBy === undefined ? {} : { importedBy: surface.importedBy }),
  };
}

function surfaceEvidence(surface: InternalSurface, line?: number): StaticEvidence {
  return {
    path: surface.displayPath,
    surface: surface.kind,
    disposition: surface.disposition,
    ...(line === undefined ? {} : { line }),
    ...(surface.fingerprint === undefined ? {} : { fingerprint: surface.fingerprint }),
  };
}

function skillEvidence(skill: SkillEvidence): StaticEvidence {
  return {
    path: skill.path,
    surface: "skill",
    disposition: skill.disposition,
  };
}

function appliedSurfaces(inspection: HostInspection): InternalSurface[] {
  return inspection.surfaces.filter((surface) => surface.disposition === "applied" && surface.content);
}

function statusWhenMissing(inspection: HostInspection, negative: boolean): "PASS" | "FAIL" | "UNKNOWN" {
  if (inspection.completeness === "partial") return "UNKNOWN";
  return negative ? "PASS" : "FAIL";
}

function suggestedDestination(target: AgentId, kind: "instruction" | "skill"): string {
  if (kind === "skill") return target === "codex" ? ".agents/skills/<name>/SKILL.md" : ".claude/skills/<name>/SKILL.md";
  return target === "codex" ? "AGENTS.md" : "CLAUDE.md";
}

function evaluateAssertion(assertion: ContextAssertion, inspection: HostInspection): ContextTrace {
  if (assertion.expect === "skill") {
    const match = inspection.skills.find(
      (skill) => skill.disposition === "available" && skill.name === assertion.name,
    );
    if (match) {
      return {
        assertionId: assertion.id,
        target: inspection.target,
        status: "PASS",
        expected: assertion,
        explanation: `skill ${assertion.name} is statically discoverable`,
        evidence: [skillEvidence(match)],
      };
    }
    const status = statusWhenMissing(inspection, false);
    return {
      assertionId: assertion.id,
      target: inspection.target,
      status,
      expected: assertion,
      explanation:
        status === "UNKNOWN"
          ? `skill ${assertion.name} was not found, but inspection is incomplete`
          : `skill ${assertion.name} was not found in supported local skill locations`,
      evidence: [],
      suggestedFix: `Install the skill at ${suggestedDestination(inspection.target, "skill")}`,
    };
  }

  if (assertion.expect === "available") {
    for (const surface of appliedSurfaces(inspection)) {
      const line = findNormalizedLine(surface.content ?? "", assertion.contains);
      if (line !== undefined) {
        return {
          assertionId: assertion.id,
          target: inspection.target,
          status: "PASS",
          expected: assertion,
          explanation: "expected text is present in statically applied context",
          evidence: [surfaceEvidence(surface, line)],
        };
      }
    }
    for (const surface of inspection.surfaces.filter(
      (candidate) => candidate.disposition === "available" && candidate.content,
    )) {
      const line = findNormalizedLine(surface.content ?? "", assertion.contains);
      if (line !== undefined) {
        return {
          assertionId: assertion.id,
          target: inspection.target,
          status: "UNKNOWN",
          expected: assertion,
          explanation: "expected text exists only in conditional or approval-dependent context",
          evidence: [surfaceEvidence(surface, line)],
        };
      }
    }
    const status = statusWhenMissing(inspection, false);
    return {
      assertionId: assertion.id,
      target: inspection.target,
      status,
      expected: assertion,
      explanation:
        status === "UNKNOWN"
          ? "expected text was not found, but inspection is incomplete"
          : "expected text was not found in supported applied context surfaces",
      evidence: [],
      suggestedFix: `Add the instruction to ${suggestedDestination(inspection.target, "instruction")}`,
    };
  }

  const matches: StaticEvidence[] = [];
  if (assertion.source) {
    for (const surface of appliedSurfaces(inspection)) {
      if (globMatches(assertion.source, surface.displayPath)) matches.push(surfaceEvidence(surface));
    }
  } else if (assertion.contains) {
    for (const surface of appliedSurfaces(inspection)) {
      const line = findNormalizedLine(surface.content ?? "", assertion.contains);
      if (line !== undefined) matches.push(surfaceEvidence(surface, line));
    }
  }
  if (matches.length) {
    return {
      assertionId: assertion.id,
      target: inspection.target,
      status: "FAIL",
      expected: assertion,
      explanation: "prohibited context is present in a statically applied surface",
      evidence: matches,
      suggestedFix: `Remove or narrow the context in ${matches[0]!.path}`,
    };
  }
  const conditionalMatches: StaticEvidence[] = [];
  if (assertion.source) {
    for (const surface of inspection.surfaces.filter((candidate) => candidate.disposition === "available")) {
      if (globMatches(assertion.source, surface.displayPath)) {
        conditionalMatches.push(surfaceEvidence(surface));
      }
    }
  } else if (assertion.contains) {
    for (const surface of inspection.surfaces.filter(
      (candidate) => candidate.disposition === "available" && candidate.content,
    )) {
      const line = findNormalizedLine(surface.content ?? "", assertion.contains);
      if (line !== undefined) conditionalMatches.push(surfaceEvidence(surface, line));
    }
  }
  if (conditionalMatches.length) {
    return {
      assertionId: assertion.id,
      target: inspection.target,
      status: "UNKNOWN",
      expected: assertion,
      explanation: "prohibited context exists in a conditional or approval-dependent surface",
      evidence: conditionalMatches,
    };
  }
  const status = statusWhenMissing(inspection, true);
  return {
    assertionId: assertion.id,
    target: inspection.target,
    status,
    expected: assertion,
    explanation:
      status === "UNKNOWN"
        ? "prohibited context was not found, but inspection is incomplete"
        : "prohibited context was not found in supported applied context surfaces",
    evidence: [],
  };
}

function publicInspection(inspection: HostInspection): TargetInspection {
  return {
    target: inspection.target,
    completeness: inspection.completeness,
    surfaces: inspection.surfaces.map(publicSurface),
    skills: inspection.skills,
    findings: inspection.findings,
  };
}

export class ContextTestRunner {
  readonly #adapters = new Map<AgentId, ContextHostAdapter>([
    ["codex", new CodexContextAdapter()],
    ["claude", new ClaudeContextAdapter()],
  ]);

  async diagnose(request: ContextTestRequest): Promise<DiagnoseResult> {
    const root = path.resolve(request.projectRoot);
    if (!fs.existsSync(root)) {
      return {
        kind: "error",
        error: { code: "ROOT_NOT_FOUND", message: `directory not found: ${root}`, path: root },
      };
    }
    if (!isDirectory(root)) {
      return {
        kind: "error",
        error: { code: "ROOT_NOT_DIRECTORY", message: `not a directory: ${root}`, path: root },
      };
    }

    const contractResult = loadContract(root, request.contractPath);
    if (contractResult.kind === "error") return contractResult;
    const contract = contractResult.kind === "contract" ? contractResult.contract : undefined;
    const selected = request.targets ?? contract?.targets ?? DEFAULT_TARGETS;
    const targets = [...new Set(selected)];
    const adapters: ContextHostAdapter[] = [];
    for (const target of targets) {
      const adapter = this.#adapters.get(target);
      if (!adapter) {
        return {
          kind: "error",
          error: { code: "TARGET_UNKNOWN", message: `unsupported target: ${target}` },
        };
      }
      adapters.push(adapter);
    }

    const inspections = adapters.map((adapter) =>
      adapter.inspect({
        projectRoot: root,
        homeDirectory: path.resolve(request.homeDirectory),
        environment: request.environment,
      }),
    );
    const traces = contract
      ? contract.assertions.flatMap((assertion) =>
          inspections.map((inspection) => evaluateAssertion(assertion, inspection)),
        )
      : [];
    const findings: StaticFinding[] = inspections.flatMap((inspection) => inspection.findings);
    const publicTargets = inspections.map(publicInspection);
    const report: Diagnosis = {
      schemaVersion: 1,
      projectRoot: root,
      ...(contract?.task === undefined ? {} : { task: contract.task }),
      ...(contractResult.kind === "contract" ? { contractPath: contractResult.path } : {}),
      targets: publicTargets,
      traces,
      differences: buildDifferences(publicTargets),
      findings,
      summary: {
        pass: traces.filter((trace) => trace.status === "PASS").length,
        fail: traces.filter((trace) => trace.status === "FAIL").length,
        unknown: traces.filter((trace) => trace.status === "UNKNOWN").length,
      },
    };
    return { kind: "report", report };
  }
}
