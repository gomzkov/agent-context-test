import type {
  AgentId,
  InspectionCompleteness,
  SkillEvidence,
  StaticFinding,
  SurfaceDisposition,
  SurfaceKind,
  SurfaceScope,
} from "../types.js";

export interface InternalSurface {
  absolutePath: string;
  displayPath: string;
  kind: SurfaceKind;
  scope: SurfaceScope;
  disposition: SurfaceDisposition;
  order?: number;
  content?: string;
  bytes?: number;
  fingerprint?: string;
  reason: string;
  importedBy?: string;
}

export interface HostInspection {
  target: AgentId;
  completeness: InspectionCompleteness;
  surfaces: readonly InternalSurface[];
  skills: readonly SkillEvidence[];
  findings: readonly StaticFinding[];
}

export interface HostInspectionRequest {
  projectRoot: string;
  homeDirectory: string;
  environment: Readonly<Record<string, string | undefined>>;
}

export interface ContextHostAdapter {
  readonly target: AgentId;
  inspect(request: HostInspectionRequest): HostInspection;
}

