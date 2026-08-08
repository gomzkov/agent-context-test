import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type {
  AgentId,
  ContextAssertion,
  ContextContract,
  DoctorError,
} from "./types.js";

export type ContractLoadResult =
  | { kind: "none" }
  | { kind: "contract"; contract: ContextContract; path: string }
  | { kind: "error"; error: DoctorError };

const CONTRACT_KEYS = new Set(["version", "task", "targets", "assertions"]);
const ASSERTION_BASE_KEYS = new Set(["id", "expect"]);

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function unexpectedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTargets(value: unknown): AgentId[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return "targets must be a non-empty list";
  }
  const targets: AgentId[] = [];
  for (const target of value) {
    if (target !== "codex" && target !== "claude") {
      return `unsupported target ${JSON.stringify(target)}; use codex or claude`;
    }
    if (!targets.includes(target)) targets.push(target);
  }
  return targets;
}

function parseAssertion(value: unknown, index: number): ContextAssertion | string {
  const input = record(value);
  if (!input) return `assertions[${index}] must be an object`;
  if (!nonEmptyString(input.id)) return `assertions[${index}].id must be a non-empty string`;
  if (!nonEmptyString(input.expect)) return `assertions[${index}].expect must be a string`;

  if (input.expect === "available") {
    const allowed = new Set([...ASSERTION_BASE_KEYS, "contains"]);
    const extra = unexpectedKeys(input, allowed);
    if (extra.length) return `assertion ${input.id} has unknown key ${extra[0]}`;
    if (!nonEmptyString(input.contains)) {
      return `assertion ${input.id} must provide a non-empty contains value`;
    }
    return { id: input.id, expect: "available", contains: input.contains };
  }

  if (input.expect === "skill") {
    const allowed = new Set([...ASSERTION_BASE_KEYS, "name"]);
    const extra = unexpectedKeys(input, allowed);
    if (extra.length) return `assertion ${input.id} has unknown key ${extra[0]}`;
    if (!nonEmptyString(input.name)) {
      return `assertion ${input.id} must provide a non-empty skill name`;
    }
    return { id: input.id, expect: "skill", name: input.name };
  }

  if (input.expect === "unavailable") {
    const allowed = new Set([...ASSERTION_BASE_KEYS, "source", "contains"]);
    const extra = unexpectedKeys(input, allowed);
    if (extra.length) return `assertion ${input.id} has unknown key ${extra[0]}`;
    const hasSource = nonEmptyString(input.source);
    const hasContains = nonEmptyString(input.contains);
    if (hasSource === hasContains) {
      return `assertion ${input.id} must provide exactly one of source or contains`;
    }
    if (hasSource) return { id: input.id, expect: "unavailable", source: input.source as string };
    return { id: input.id, expect: "unavailable", contains: input.contains as string };
  }

  return `assertion ${input.id} has unsupported expectation ${JSON.stringify(input.expect)}`;
}

function validateContract(value: unknown): ContextContract | string {
  const input = record(value);
  if (!input) return "contract must be a YAML object";
  const extra = unexpectedKeys(input, CONTRACT_KEYS);
  if (extra.length) return `contract has unknown key ${extra[0]}`;
  if (input.version !== 1) return "contract version must be 1";
  if (input.task !== undefined && !nonEmptyString(input.task)) {
    return "task must be a non-empty string when provided";
  }
  if (!Array.isArray(input.assertions)) return "assertions must be a list";

  let targets: AgentId[] | undefined;
  if (input.targets !== undefined) {
    const parsed = parseTargets(input.targets);
    if (typeof parsed === "string") return parsed;
    targets = parsed;
  }

  const assertions: ContextAssertion[] = [];
  const identifiers = new Set<string>();
  for (let index = 0; index < input.assertions.length; index++) {
    const assertion = parseAssertion(input.assertions[index], index);
    if (typeof assertion === "string") return assertion;
    if (identifiers.has(assertion.id)) return `duplicate assertion id ${assertion.id}`;
    identifiers.add(assertion.id);
    assertions.push(assertion);
  }

  return {
    version: 1,
    ...(input.task === undefined ? {} : { task: input.task as string }),
    ...(targets === undefined ? {} : { targets }),
    assertions,
  };
}

export function loadContract(
  projectRoot: string,
  explicitPath?: string,
): ContractLoadResult {
  const resolved = explicitPath
    ? path.resolve(projectRoot, explicitPath)
    : path.join(projectRoot, ".context-tests.yml");

  if (!fs.existsSync(resolved)) {
    if (!explicitPath) return { kind: "none" };
    return {
      kind: "error",
      error: {
        code: "CONTRACT_NOT_FOUND",
        message: `context contract not found: ${resolved}`,
        path: resolved,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = parse(fs.readFileSync(resolved, "utf8"), { uniqueKeys: true });
  } catch (error) {
    return {
      kind: "error",
      error: {
        code: "CONTRACT_INVALID",
        message: `could not parse ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
        path: resolved,
      },
    };
  }

  const contract = validateContract(parsed);
  if (typeof contract === "string") {
    return {
      kind: "error",
      error: {
        code: "CONTRACT_INVALID",
        message: `${resolved}: ${contract}`,
        path: resolved,
      },
    };
  }
  return { kind: "contract", contract, path: resolved };
}
