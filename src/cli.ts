#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ContextTestRunner } from "./runner.js";
import { renderDiagnosis, suggestedExitCode } from "./render.js";
import type { AgentId, ContextScope, OutputFormat } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

function help(): string {
  return `context-test ${metadata.version}

Test which instructions and skills Codex and Claude can discover.

Usage:
  context-test [directory] [options]

Options:
  --contract <path>                  Use a context contract
  --target <codex|claude>            Inspect one target; repeatable
  --scope <project|user|all>         Detail scope for terminal/Markdown (default: project)
  --format <terminal|markdown|json>  Output format
  --output <path>                    Write the report to a file
  --home <path>                      Override the home directory
  --no-color                         Disable terminal colors
  -h, --help                         Show help
  -v, --version                      Show version`;
}

function fail(message: string): never {
  console.error(`context-test: ${message}`);
  process.exit(2);
}

const withoutNoColor = process.argv.slice(2).filter((argument) => argument !== "--no-color");
const noColor = withoutNoColor.length !== process.argv.length - 2 || process.env.NO_COLOR !== undefined;
const parsed = (() => {
  try {
    return parseArgs({
      args: withoutNoColor,
      allowPositionals: true,
      options: {
        contract: { type: "string" },
        target: { type: "string", multiple: true },
        scope: { type: "string" },
        format: { type: "string" },
        output: { type: "string" },
        home: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
})();

if (parsed.values.help) {
  console.log(help());
  process.exit(0);
}
if (parsed.values.version) {
  console.log(metadata.version);
  process.exit(0);
}

const positionals = [...parsed.positionals];
if (positionals.length > 1) fail("accepts at most one directory");

const projectRoot = path.resolve(positionals[0] ?? process.cwd());
const format = (parsed.values.format ?? "terminal") as OutputFormat;
if (!(["terminal", "markdown", "json"] as const).includes(format)) {
  fail(`unsupported format ${format}; use terminal, markdown, or json`);
}
const targets = parsed.values.target?.map((target) => {
  if (target !== "codex" && target !== "claude") fail(`unsupported target ${target}`);
  return target as AgentId;
});
const scope = (parsed.values.scope ?? "project") as ContextScope;
if (!(["project", "user", "all"] as const).includes(scope)) {
  fail(`unsupported scope ${scope}; use project, user, or all`);
}
const homeDirectory = path.resolve(parsed.values.home ?? os.homedir());

const runner = new ContextTestRunner();
const result = await runner.diagnose({
  projectRoot,
  homeDirectory,
  environment: process.env,
  ...(parsed.values.contract === undefined ? {} : { contractPath: parsed.values.contract }),
  ...(targets === undefined ? {} : { targets }),
});
if (result.kind === "error") fail(result.error.message);

const outputPath = parsed.values.output ? path.resolve(parsed.values.output) : undefined;
const rendered = renderDiagnosis(result.report, format, {
  color: format === "terminal" && !outputPath && !noColor && process.stdout.isTTY,
  scope,
});
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered);
  console.log(`Wrote ${outputPath}`);
} else process.stdout.write(rendered);
process.exitCode = suggestedExitCode(result.report);
