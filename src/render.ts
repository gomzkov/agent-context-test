import { buildDifferences, evidenceInScope } from "./differences.js";
import type {
  AgentId,
  ContextScope,
  ContextTrace,
  CrossAgentDifference,
  Diagnosis,
  OutputFormat,
  TargetInspection,
} from "./types.js";

interface Colors {
  bold: string;
  dim: string;
  green: string;
  red: string;
  yellow: string;
  cyan: string;
  reset: string;
}

interface RenderOptions {
  color?: boolean;
  scope?: ContextScope;
}

function colors(enabled: boolean): Colors {
  if (!enabled) return { bold: "", dim: "", green: "", red: "", yellow: "", cyan: "", reset: "" };
  return {
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    reset: "\x1b[0m",
  };
}

function statusText(trace: ContextTrace, color: Colors): string {
  if (trace.status === "PASS") return `${color.green}PASS${color.reset}`;
  if (trace.status === "FAIL") return `${color.red}FAIL${color.reset}`;
  return `${color.yellow}UNKNOWN${color.reset}`;
}

function targetTrace(report: Diagnosis, assertionId: string, target: AgentId): ContextTrace | undefined {
  return report.traces.find((trace) => trace.assertionId === assertionId && trace.target === target);
}

function title(scope: Exclude<ContextScope, "all">): "Project" | "User" {
  return scope === "project" ? "Project" : "User";
}

function scopedSurfaceCount(target: TargetInspection, scope: ContextScope): number {
  return target.surfaces.filter(
    (surface) => surface.disposition === "applied" && evidenceInScope(surface.scope, scope),
  ).length;
}

function scopedSkillCount(target: TargetInspection, scope: ContextScope): number {
  return target.skills.filter(
    (skill) => skill.disposition === "available" && evidenceInScope(skill.scope, scope),
  ).length;
}

function terminalMetrics(
  out: string[],
  report: Diagnosis,
  targets: readonly AgentId[],
  scope: ContextScope,
): void {
  const labelWidth = 32;
  out.push(`${"".padEnd(labelWidth)}${targets.map((target) => target.padStart(10)).join("")}`);
  const metric = (label: string, values: readonly number[]): void => {
    out.push(`${label.padEnd(labelWidth)}${values.map((value) => String(value).padStart(10)).join("")}`);
  };
  const addScope = (view: Exclude<ContextScope, "all">): void => {
    metric(
      `Applied ${view} surfaces`,
      report.targets.map((target) => scopedSurfaceCount(target, view)),
    );
    metric(
      `Available ${view} skills`,
      report.targets.map((target) => scopedSkillCount(target, view)),
    );
  };
  if (scope === "all") {
    addScope("project");
    addScope("user");
  } else addScope(scope);
  metric(
    "Warnings",
    report.targets.map(
      (target) => target.findings.filter((finding) => finding.severity === "warning").length,
    ),
  );
}

function pushTerminalSources(
  out: string[],
  report: Diagnosis,
  scope: Exclude<ContextScope, "all">,
  color: Colors,
): void {
  out.push(`${color.bold}${title(scope)} sources${color.reset}`);
  for (const target of report.targets) {
    out.push(`  ${color.bold}${target.target}${color.reset}${target.completeness === "partial" ? ` ${color.yellow}(partial)${color.reset}` : ""}`);
    const visible = target.surfaces.filter(
      (surface) =>
        evidenceInScope(surface.scope, scope) &&
        (surface.disposition !== "ignored" || (surface.bytes ?? 0) > 0),
    );
    if (!visible.length) out.push(`    ${color.dim}no supported ${scope} context found${color.reset}`);
    for (const surface of visible) {
      const mark = surface.disposition === "applied" ? color.green + "✓" : surface.disposition === "unreadable" ? color.red + "!" : color.yellow + "·";
      out.push(`    ${mark}${color.reset} ${surface.path} ${color.dim}${surface.disposition} · ${surface.kind}${color.reset}`);
    }
  }
  out.push("");
}

function pushTerminalDifferences(
  out: string[],
  report: Diagnosis,
  scope: Exclude<ContextScope, "all">,
  color: Colors,
): void {
  const differences = buildDifferences(report.targets, scope);
  if (!differences.length) return;
  out.push(`${color.bold}${title(scope)} differences${color.reset}`);
  for (const difference of differences.slice(0, 20)) {
    out.push(
      `  ${color.cyan}·${color.reset} ${difference.kind} ${difference.item} ${color.dim}only in ${difference.presentIn.join(", ")}${color.reset}`,
    );
  }
  if (differences.length > 20) {
    out.push(`  ${color.dim}… ${differences.length - 20} more in JSON/Markdown output${color.reset}`);
  }
  out.push("");
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function hiddenUserDifferences(report: Diagnosis): string | undefined {
  const differences = buildDifferences(report.targets, "user");
  const surfaces = differences.filter((difference) => difference.kind === "surface").length;
  const skills = differences.filter((difference) => difference.kind === "skill").length;
  const parts: string[] = [];
  if (surfaces) parts.push(`${plural(surfaces, "user surface difference")} hidden`);
  if (skills) parts.push(`${plural(skills, "user skill difference")} hidden`);
  if (!parts.length) return undefined;
  return `${parts.join(", ")}; use --scope all to show them.`;
}

function terminal(report: Diagnosis, useColor: boolean, scope: ContextScope): string {
  const color = colors(useColor);
  const out: string[] = [];
  const targets = report.targets.map((target) => target.target);
  out.push(`${color.bold}Agent Context Test${color.reset}`);
  out.push(`${color.dim}${report.projectRoot}${color.reset}`);
  if (report.task) out.push(`${color.dim}Task: ${report.task}${color.reset}`);
  out.push("");

  terminalMetrics(out, report, targets, scope);
  out.push("");

  if (report.traces.length) {
    const labelWidth = 32;
    out.push(`${color.bold}Contract${color.reset}`);
    const assertionIds = [...new Set(report.traces.map((trace) => trace.assertionId))];
    for (const assertionId of assertionIds) {
      const cells = targets.map((target) => {
        const trace = targetTrace(report, assertionId, target);
        return (trace ? statusText(trace, color) : "-").padStart(10 + (useColor ? 9 : 0));
      });
      out.push(`${assertionId.padEnd(labelWidth)}${cells.join("")}`);
    }
    out.push("");
    for (const trace of report.traces.filter((item) => item.status !== "PASS")) {
      out.push(`${statusText(trace, color)} ${color.bold}${trace.assertionId}${color.reset} · ${trace.target}`);
      out.push(`  ${trace.explanation}`);
      for (const evidence of trace.evidence) {
        out.push(`  ${color.dim}${evidence.path}${evidence.line ? `:${evidence.line}` : ""}${color.reset}`);
      }
      if (trace.suggestedFix) out.push(`  ${color.cyan}Fix: ${trace.suggestedFix}${color.reset}`);
    }
    if (report.traces.some((trace) => trace.status !== "PASS")) out.push("");
  }

  const scopes: readonly Exclude<ContextScope, "all">[] = scope === "all" ? ["project", "user"] : [scope];
  for (const view of scopes) {
    pushTerminalSources(out, report, view, color);
    pushTerminalDifferences(out, report, view, color);
  }

  if (scope === "project") {
    const hidden = hiddenUserDifferences(report);
    if (hidden) out.push(`${color.dim}${hidden}${color.reset}`, "");
  }

  const warnings = report.findings.filter((finding) => finding.severity === "warning");
  if (warnings.length) {
    out.push(`${color.bold}Warnings${color.reset}`);
    for (const warning of warnings) out.push(`  ${color.yellow}!${color.reset} ${warning.message}`);
    out.push("");
  }

  out.push(
    `${color.dim}Static evidence only. Runtime flags, hooks, plugins, MCP, prompts, and hidden instructions may add context.${color.reset}`,
  );
  return out.join("\n");
}

function pushMarkdownSources(
  out: string[],
  report: Diagnosis,
  scope: Exclude<ContextScope, "all">,
): void {
  out.push(`## ${title(scope)} sources`, "");
  for (const target of report.targets) {
    out.push(`### ${target.target}${target.completeness === "partial" ? " (partial)" : ""}`, "");
    const visible = target.surfaces.filter(
      (surface) =>
        evidenceInScope(surface.scope, scope) &&
        (surface.disposition !== "ignored" || (surface.bytes ?? 0) > 0),
    );
    if (!visible.length) out.push(`No supported ${scope} context found.`, "");
    else {
      for (const surface of visible) out.push(`- \`${surface.path}\` — ${surface.disposition}, ${surface.kind}`);
      out.push("");
    }
  }
}

function pushMarkdownDifferences(
  out: string[],
  report: Diagnosis,
  scope: Exclude<ContextScope, "all">,
): void {
  const differences = buildDifferences(report.targets, scope);
  if (!differences.length) return;
  out.push(`## ${title(scope)} differences`, "");
  for (const difference of differences) {
    out.push(`- ${difference.kind} \`${difference.item}\` is available only to ${difference.presentIn.join(", ")}.`);
  }
  out.push("");
}

function markdown(report: Diagnosis, scope: ContextScope): string {
  const out: string[] = ["# Agent Context Test report", "", `Project: \`${report.projectRoot}\``];
  if (report.task) out.push(`Task: ${report.task}`);
  out.push("", "## Summary", "");

  if (scope === "all") {
    out.push(
      "| Target | Project surfaces | Project skills | User surfaces | User skills | Warnings |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const target of report.targets) {
      out.push(
        `| ${target.target} | ${scopedSurfaceCount(target, "project")} | ${scopedSkillCount(target, "project")} | ${scopedSurfaceCount(target, "user")} | ${scopedSkillCount(target, "user")} | ${target.findings.filter((finding) => finding.severity === "warning").length} |`,
      );
    }
  } else {
    out.push(
      `| Target | Applied ${scope} surfaces | Available ${scope} skills | Warnings |`,
      "| --- | ---: | ---: | ---: |",
    );
    for (const target of report.targets) {
      out.push(
        `| ${target.target} | ${scopedSurfaceCount(target, scope)} | ${scopedSkillCount(target, scope)} | ${target.findings.filter((finding) => finding.severity === "warning").length} |`,
      );
    }
  }

  if (report.traces.length) {
    const targets = report.targets.map((target) => target.target);
    const assertionIds = [...new Set(report.traces.map((trace) => trace.assertionId))];
    out.push("", "## Contract", "", `| Assertion | ${targets.join(" | ")} |`, `| --- | ${targets.map(() => "---").join(" | ")} |`);
    for (const assertionId of assertionIds) {
      out.push(
        `| ${assertionId} | ${targets.map((target) => targetTrace(report, assertionId, target)?.status ?? "-").join(" | ")} |`,
      );
    }
    const nonPassing = report.traces.filter((trace) => trace.status !== "PASS");
    if (nonPassing.length) {
      out.push("", "### Details", "");
      for (const trace of nonPassing) {
        out.push(`- **${trace.status} ${trace.assertionId} · ${trace.target}:** ${trace.explanation}`);
        for (const evidence of trace.evidence) out.push(`  - \`${evidence.path}${evidence.line ? `:${evidence.line}` : ""}\``);
        if (trace.suggestedFix) out.push(`  - Fix: ${trace.suggestedFix}`);
      }
    }
  }

  const scopes: readonly Exclude<ContextScope, "all">[] = scope === "all" ? ["project", "user"] : [scope];
  for (const view of scopes) {
    out.push("");
    pushMarkdownSources(out, report, view);
    pushMarkdownDifferences(out, report, view);
  }
  if (scope === "project") {
    const hidden = hiddenUserDifferences(report);
    if (hidden) out.push(`> ${hidden}`, "");
  }

  const warnings = report.findings.filter((finding) => finding.severity === "warning");
  if (warnings.length) {
    out.push("## Warnings", "");
    for (const warning of warnings) out.push(`- ${warning.message}`);
    out.push("");
  }
  out.push(
    "> Static evidence only. Runtime flags, hooks, plugins, MCP responses, prompts, and hidden instructions may add context.",
  );
  return out.join("\n");
}

export function renderDiagnosis(
  report: Diagnosis,
  format: OutputFormat,
  options: RenderOptions = {},
): string {
  if (format === "json") return JSON.stringify(report, null, 2) + "\n";
  const scope = options.scope ?? "project";
  if (format === "markdown") return markdown(report, scope) + "\n";
  return terminal(report, options.color ?? false, scope) + "\n";
}

export function suggestedExitCode(report: Diagnosis): 0 | 1 {
  return report.summary.fail > 0 ? 1 : 0;
}
