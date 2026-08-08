# Context Doctor

See which instructions and skills Codex and Claude can discover before you start a task.

```bash
npx @gomzkov/context-doctor doctor
```

Context Doctor inspects supported local context surfaces. It does not call an AI model, upload files, modify configuration, or claim access to hidden prompts.

> Early v0. The interface and report schema may change before `1.0`.

## What it checks

- Codex `AGENTS.md` discovery, overrides, fallback filenames, size limits, and Agent Skills
- Claude Code `CLAUDE.md`, local instructions, imports, rules, auto memory, and skills
- Content and skills available to one agent but missing from the other
- Optional deterministic assertions in `.context-tests.yml`

Codex and Claude do not load context the same way. A preference in `AGENTS.md` may be invisible to Claude. A Claude rule may load only for certain files. Context Doctor shows those differences without asking either agent to describe itself.

With a contract, the report starts with a small matrix:

```text
                                 codex    claude
run-tests                         PASS      PASS
writing-style                     PASS      FAIL
private-notes                     PASS   UNKNOWN
```

Every non-passing result explains the evidence. Failed checks suggest a fix when the tool can do that safely.

## Usage

```text
context-doctor doctor [directory]

Options:
  --contract <path>                  Use a context contract
  --target <codex|claude>            Inspect one target; repeatable
  --format <terminal|markdown|json>  Output format
  --output <path>                    Write the report to a file
  --home <path>                      Override the home directory (tests/CI)
  --no-color                         Disable terminal colors
  -h, --help                         Show help
  -v, --version                      Show version
```

Without `--contract`, Context Doctor reports discovered surfaces, available skills, ignored files, broken imports, and exact cross-agent surface differences.

## Context contracts

Put `.context-tests.yml` in the project or pass another file with `--contract`:

```yaml
version: 1
task: public-copy
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
    source: "personal/health/**"
```

Results are `PASS`, `FAIL`, or `UNKNOWN`. A static `PASS` means supported local surfaces contain the expected evidence. It does not guarantee that a model will obey an instruction.

`contains` checks are case-sensitive after normalizing whitespace and line endings. `source` supports `*`, `**`, and `?` globs relative to the Git root. Contract keys are strict, so a typo fails the run instead of silently skipping a check.

This repository uses its own [context contract](./.context-tests.yml). `CLAUDE.md` imports `AGENTS.md`, so both agents receive the same project guidance.

Exit codes:

- `0`: inspection completed with no failed assertions
- `1`: one or more assertions failed
- `2`: invalid request or no trustworthy report could be produced

## Sources and limits

The adapters follow the documented local discovery behavior for [Codex `AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code memory](https://code.claude.com/docs/en/memory), and [Claude Code skills](https://code.claude.com/docs/en/skills).

Runtime flags, some managed settings, plugins, hooks, MCP responses, cloud-only context, and hidden system instructions may add context the static inspector cannot see. The report names these limits instead of guessing.

Context Doctor reads files but never writes to the inspected project. Reports contain paths, fingerprints, and contract-provided text, not arbitrary instruction contents. Check a Markdown or JSON report before sharing it because paths and assertion text can still be private.

## Development

```bash
npm install
npm test
```

MIT
