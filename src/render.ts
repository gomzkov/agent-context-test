import type { AgentId, ContextTrace, Diagnosis, OutputFormat } from "./types.js";

interface Colors {
  bold: string;
  dim: string;
  green: string;
  red: string;
  yellow: string;
  cyan: string;
  reset: string;
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

function terminal(report: Diagnosis, useColor: boolean): string {
  const color = colors(useColor);
  const out: string[] = [];
  const targets = report.targets.map((target) => target.target);
  out.push(`${color.bold}Context Doctor${color.reset}`);
  out.push(`${color.dim}${report.projectRoot}${color.reset}`);
  if (report.task) out.push(`${color.dim}Task: ${report.task}${color.reset}`);
  out.push("");

  const labelWidth = 28;
  out.push(`${"".padEnd(labelWidth)}${targets.map((target) => target.padStart(10)).join("")}`);
  const metric = (label: string, values: readonly number[]): void => {
    out.push(`${label.padEnd(labelWidth)}${values.map((value) => String(value).padStart(10)).join("")}`);
  };
  metric(
    "Applied context surfaces",
    report.targets.map((target) => target.surfaces.filter((surface) => surface.disposition === "applied").length),
  );
  metric(
    "Available skills",
    report.targets.map((target) => target.skills.filter((skill) => skill.disposition === "available").length),
  );
  metric(
    "Warnings",
    report.targets.map(
      (target) => target.findings.filter((finding) => finding.severity === "warning").length,
    ),
  );
  out.push("");

  if (report.traces.length) {
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

  out.push(`${color.bold}Sources${color.reset}`);
  for (const target of report.targets) {
    out.push(`  ${color.bold}${target.target}${color.reset}${target.completeness === "partial" ? ` ${color.yellow}(partial)${color.reset}` : ""}`);
    const visible = target.surfaces.filter(
      (surface) => surface.disposition !== "ignored" || (surface.bytes ?? 0) > 0,
    );
    if (!visible.length) out.push(`    ${color.dim}no supported context files found${color.reset}`);
    for (const surface of visible) {
      const mark = surface.disposition === "applied" ? color.green + "✓" : surface.disposition === "unreadable" ? color.red + "!" : color.yellow + "·";
      out.push(`    ${mark}${color.reset} ${surface.path} ${color.dim}${surface.disposition} · ${surface.kind}${color.reset}`);
    }
  }
  out.push("");

  if (report.differences.length) {
    out.push(`${color.bold}Differences${color.reset}`);
    for (const difference of report.differences.slice(0, 20)) {
      out.push(
        `  ${color.cyan}·${color.reset} ${difference.kind} ${difference.item} ${color.dim}only in ${difference.presentIn.join(", ")}${color.reset}`,
      );
    }
    if (report.differences.length > 20) {
      out.push(`  ${color.dim}… ${report.differences.length - 20} more in JSON/Markdown output${color.reset}`);
    }
    out.push("");
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

function markdown(report: Diagnosis): string {
  const out: string[] = ["# Context Doctor report", "", `Project: \`${report.projectRoot}\``];
  if (report.task) out.push(`Task: ${report.task}`);
  out.push("");
  out.push("## Summary", "");
  out.push("| Target | Applied surfaces | Available skills | Warnings |", "| --- | ---: | ---: | ---: |");
  for (const target of report.targets) {
    out.push(
      `| ${target.target} | ${target.surfaces.filter((surface) => surface.disposition === "applied").length} | ${target.skills.filter((skill) => skill.disposition === "available").length} | ${target.findings.filter((finding) => finding.severity === "warning").length} |`,
    );
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

  out.push("", "## Sources", "");
  for (const target of report.targets) {
    out.push(`### ${target.target}${target.completeness === "partial" ? " (partial)" : ""}`, "");
    const visible = target.surfaces.filter(
      (surface) => surface.disposition !== "ignored" || (surface.bytes ?? 0) > 0,
    );
    if (!visible.length) out.push("No supported context files found.", "");
    else {
      for (const surface of visible) out.push(`- \`${surface.path}\` — ${surface.disposition}, ${surface.kind}`);
      out.push("");
    }
  }

  if (report.differences.length) {
    out.push("## Differences", "");
    for (const difference of report.differences) {
      out.push(`- ${difference.kind} \`${difference.item}\` is available only to ${difference.presentIn.join(", ")}.`);
    }
    out.push("");
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
  options: { color?: boolean } = {},
): string {
  if (format === "json") return JSON.stringify(report, null, 2) + "\n";
  if (format === "markdown") return markdown(report) + "\n";
  return terminal(report, options.color ?? false) + "\n";
}

export function suggestedExitCode(report: Diagnosis): 0 | 1 {
  return report.summary.fail > 0 ? 1 : 0;
}
