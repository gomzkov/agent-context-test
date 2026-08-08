export type AgentId = "codex" | "claude";
export type OutputFormat = "terminal" | "markdown" | "json";
export type ContextScope = "project" | "user" | "all";
export type AssertionStatus = "PASS" | "FAIL" | "UNKNOWN";
export type InspectionCompleteness = "complete" | "partial";
export type SurfaceKind = "instruction" | "rule" | "memory" | "import";
export type SurfaceScope = "managed" | "user" | "project" | "nested";
export type SurfaceDisposition =
  | "applied"
  | "available"
  | "shadowed"
  | "ignored"
  | "unreadable";

export type ContextAssertion =
  | {
      id: string;
      expect: "available";
      contains: string;
    }
  | {
      id: string;
      expect: "skill";
      name: string;
    }
  | {
      id: string;
      expect: "unavailable";
      source?: string;
      contains?: string;
    };

export interface ContextContract {
  version: 1;
  task?: string;
  targets?: readonly AgentId[];
  assertions: readonly ContextAssertion[];
}

export interface SurfaceEvidence {
  path: string;
  kind: SurfaceKind;
  scope: SurfaceScope;
  disposition: SurfaceDisposition;
  order?: number;
  bytes?: number;
  fingerprint?: string;
  reason: string;
  importedBy?: string;
}

export interface SkillEvidence {
  name: string;
  path: string;
  scope: SurfaceScope;
  disposition: "available" | "shadowed" | "ignored" | "unreadable";
  reason: string;
}

export type FindingSeverity = "warning" | "info";

export interface StaticFinding {
  code: string;
  severity: FindingSeverity;
  message: string;
  target?: AgentId;
  path?: string;
}

export interface TargetInspection {
  target: AgentId;
  completeness: InspectionCompleteness;
  surfaces: readonly SurfaceEvidence[];
  skills: readonly SkillEvidence[];
  findings: readonly StaticFinding[];
}

export interface StaticEvidence {
  path: string;
  surface: SurfaceKind | "skill";
  disposition: SurfaceDisposition | SkillEvidence["disposition"];
  line?: number;
  fingerprint?: string;
}

export interface ContextTrace {
  assertionId: string;
  target: AgentId;
  status: AssertionStatus;
  expected: ContextAssertion;
  explanation: string;
  evidence: readonly StaticEvidence[];
  suggestedFix?: string;
}

export interface CrossAgentDifference {
  kind: "surface" | "skill";
  item: string;
  presentIn: readonly AgentId[];
  missingFrom: readonly AgentId[];
}

export interface Diagnosis {
  schemaVersion: 1;
  projectRoot: string;
  task?: string;
  contractPath?: string;
  targets: readonly TargetInspection[];
  traces: readonly ContextTrace[];
  differences: readonly CrossAgentDifference[];
  findings: readonly StaticFinding[];
  summary: {
    pass: number;
    fail: number;
    unknown: number;
  };
}

export interface ContextTestRequest {
  projectRoot: string;
  homeDirectory: string;
  environment: Readonly<Record<string, string | undefined>>;
  contractPath?: string;
  targets?: readonly AgentId[];
}

export type ContextTestErrorCode =
  | "ROOT_NOT_FOUND"
  | "ROOT_NOT_DIRECTORY"
  | "CONTRACT_NOT_FOUND"
  | "CONTRACT_INVALID"
  | "TARGET_UNKNOWN";

export interface ContextTestError {
  code: ContextTestErrorCode;
  message: string;
  path?: string;
}

export type DiagnoseResult =
  | { kind: "report"; report: Diagnosis }
  | { kind: "error"; error: ContextTestError };
