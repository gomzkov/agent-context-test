import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ContextDoctor } from "../src/doctor.js";

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function fixture(t: test.TestContext): { root: string; home: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "context-doctor-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { root, home };
}

test("models Codex instruction precedence and fallback behavior", async (t) => {
  const { root, home } = fixture(t);
  const nested = path.join(root, "packages", "app");
  fs.mkdirSync(nested, { recursive: true });
  write(path.join(home, ".codex", "AGENTS.md"), "Global instruction\n");
  write(
    path.join(home, ".codex", "config.toml"),
    'project_doc_fallback_filenames = ["TEAM_GUIDE.md"]\nproject_doc_max_bytes = 65536\n',
  );
  write(path.join(root, "AGENTS.md"), "Root instruction\n");
  write(path.join(root, "TEAM_GUIDE.md"), "Ignored fallback\n");
  write(path.join(nested, "AGENTS.override.md"), "Nested override\n");
  write(path.join(nested, "AGENTS.md"), "Shadowed nested instruction\n");

  const result = await new ContextDoctor().diagnose({
    projectRoot: nested,
    homeDirectory: home,
    environment: {},
    targets: ["codex"],
  });
  assert.equal(result.kind, "report");
  if (result.kind !== "report") return;
  const codex = result.report.targets[0]!;
  assert.deepEqual(
    codex.surfaces
      .filter((surface) => surface.disposition === "applied")
      .map((surface) => surface.path),
    ["~/.codex/AGENTS.md", "AGENTS.md", "packages/app/AGENTS.override.md"],
  );
  assert.equal(
    codex.surfaces.find((surface) => surface.path === "packages/app/AGENTS.md")?.disposition,
    "shadowed",
  );
  assert.equal(
    codex.surfaces.find((surface) => surface.path === "TEAM_GUIDE.md")?.disposition,
    "shadowed",
  );
});

test("models Claude instructions, imports, rules, memory, and skills", async (t) => {
  const { root, home } = fixture(t);
  write(path.join(home, ".claude", "CLAUDE.md"), "Personal style. See @profile.md\n");
  write(path.join(home, ".claude", "profile.md"), "Use short answers.\n");
  write(path.join(root, "CLAUDE.md"), "Project rules in @docs/shared.md\n");
  write(path.join(root, "docs", "shared.md"), "Run npm test.\n");
  write(path.join(root, ".claude", "rules", "always.md"), "Never commit secrets.\n");
  write(
    path.join(root, ".claude", "rules", "typescript.md"),
    '---\npaths:\n  - "src/**/*.ts"\n---\nUse strict TypeScript.\n',
  );
  write(
    path.join(home, ".claude", "projects", root.replace(/[^A-Za-z0-9_-]/g, "-"), "memory", "MEMORY.md"),
    "Tests use node:test.\n",
  );
  write(
    path.join(root, ".claude", "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review changes\n---\nReview the diff.\n",
  );

  const result = await new ContextDoctor().diagnose({
    projectRoot: root,
    homeDirectory: home,
    environment: {},
    targets: ["claude"],
  });
  assert.equal(result.kind, "report");
  if (result.kind !== "report") return;
  const claude = result.report.targets[0]!;
  const surfaces = new Map(claude.surfaces.map((surface) => [surface.path, surface]));
  assert.equal(surfaces.get("~/.claude/CLAUDE.md")?.disposition, "applied");
  assert.equal(surfaces.get("~/.claude/profile.md")?.kind, "import");
  assert.equal(surfaces.get("docs/shared.md")?.disposition, "applied");
  assert.equal(surfaces.get(".claude/rules/always.md")?.disposition, "applied");
  assert.equal(surfaces.get(".claude/rules/typescript.md")?.disposition, "available");
  assert.equal(
    claude.surfaces.some((surface) => surface.kind === "memory" && surface.disposition === "applied"),
    true,
  );
  assert.equal(
    claude.skills.some((skill) => skill.name === "review" && skill.disposition === "available"),
    true,
  );
});

test("evaluates deterministic contract assertions per target", async (t) => {
  const { root, home } = fixture(t);
  write(path.join(root, "AGENTS.md"), "Use plain, direct English.\n");
  write(path.join(root, "CLAUDE.md"), "Read @private/health.md\n");
  write(path.join(root, "private", "health.md"), "Private health information.\n");
  write(
    path.join(root, ".agents", "skills", "say-it-normally", "SKILL.md"),
    "---\nname: say-it-normally\ndescription: Write normally\n---\n",
  );
  write(
    path.join(root, ".context-tests.yml"),
    `version: 1
targets: [codex, claude]
assertions:
  - id: direct-writing
    expect: available
    contains: "Use plain, direct English"
  - id: writing-skill
    expect: skill
    name: say-it-normally
  - id: private-health
    expect: unavailable
    source: "private/**"
`,
  );

  const result = await new ContextDoctor().diagnose({
    projectRoot: root,
    homeDirectory: home,
    environment: {},
  });
  assert.equal(result.kind, "report");
  if (result.kind !== "report") return;
  assert.deepEqual(result.report.summary, { pass: 3, fail: 3, unknown: 0 });
  const statuses = Object.fromEntries(
    result.report.traces.map((trace) => [`${trace.assertionId}:${trace.target}`, trace.status]),
  );
  assert.equal(statuses["direct-writing:codex"], "PASS");
  assert.equal(statuses["direct-writing:claude"], "FAIL");
  assert.equal(statuses["writing-skill:codex"], "PASS");
  assert.equal(statuses["writing-skill:claude"], "FAIL");
  assert.equal(statuses["private-health:codex"], "PASS");
  assert.equal(statuses["private-health:claude"], "FAIL");
});

test("CLI emits JSON and assertion failures use exit code 1", (t) => {
  const { root, home } = fixture(t);
  write(path.join(root, "AGENTS.md"), "Codex only instruction.\n");
  write(
    path.join(root, ".context-tests.yml"),
    `version: 1
targets: [codex, claude]
assertions:
  - id: shared
    expect: available
    contains: "Codex only instruction"
`,
  );
  const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");
  const result = spawnSync(
    process.execPath,
    [cliPath, "doctor", root, "--home", home, "--format", "json", "--no-color"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout) as { schemaVersion: number; summary: { fail: number } };
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.summary.fail, 1);
});

test("invalid contracts fail without producing a report", async (t) => {
  const { root, home } = fixture(t);
  write(
    path.join(root, ".context-tests.yml"),
    "version: 1\nassertions:\n  - id: broken\n    expect: available\n    contains: value\n    typo: true\n",
  );
  const result = await new ContextDoctor().diagnose({
    projectRoot: root,
    homeDirectory: home,
    environment: {},
  });
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.error.code, "CONTRACT_INVALID");
});

test("conditional Claude rules produce UNKNOWN instead of a false claim", async (t) => {
  const { root, home } = fixture(t);
  write(
    path.join(root, ".claude", "rules", "typescript.md"),
    '---\npaths:\n  - "src/**/*.ts"\n---\nUse strict TypeScript.\n',
  );
  write(
    path.join(root, ".context-tests.yml"),
    `version: 1
targets: [claude]
assertions:
  - id: strict-typescript
    expect: available
    contains: "Use strict TypeScript"
`,
  );
  const result = await new ContextDoctor().diagnose({
    projectRoot: root,
    homeDirectory: home,
    environment: {},
  });
  assert.equal(result.kind, "report");
  if (result.kind !== "report") return;
  assert.equal(result.report.traces[0]?.status, "UNKNOWN");
  assert.match(result.report.traces[0]?.explanation ?? "", /conditional/);
});

test("Codex respects active byte limits and ignores commented config examples", async (t) => {
  const { root, home } = fixture(t);
  write(
    path.join(home, ".codex", "config.toml"),
    "# project_doc_max_bytes = 1\nproject_doc_max_bytes = 12\n",
  );
  write(path.join(root, "AGENTS.md"), "This instruction is longer than twelve bytes.\n");
  const result = await new ContextDoctor().diagnose({
    projectRoot: root,
    homeDirectory: home,
    environment: {},
    targets: ["codex"],
  });
  assert.equal(result.kind, "report");
  if (result.kind !== "report") return;
  assert.equal(result.report.targets[0]?.surfaces[0]?.disposition, "ignored");
  assert.equal(
    result.report.findings.some((finding) => finding.code === "codex-instruction-limit"),
    true,
  );
});

test("CLI writes a Markdown report without terminal escapes", (t) => {
  const { root, home } = fixture(t);
  write(path.join(root, "AGENTS.md"), "Run npm test.\n");
  const outputPath = path.join(root, "reports", "context.md");
  const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "doctor",
      root,
      "--home",
      home,
      "--format",
      "markdown",
      "--output",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = fs.readFileSync(outputPath, "utf8");
  assert.match(report, /^# Context Doctor report/);
  assert.equal(report.includes("\x1b["), false);
});
