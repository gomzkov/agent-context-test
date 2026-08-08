# Agent Context Test

Test whether Codex and Claude can find the instructions and skills a task needs.

[![CI](https://github.com/gomzkov/agent-context-test/actions/workflows/ci.yml/badge.svg)](https://github.com/gomzkov/agent-context-test/actions/workflows/ci.yml)

```bash
npx @gomzkov/agent-context-test
```

The command reads your local agent configuration and compares what each supported agent can discover. It makes no model calls and does not upload your files.

```text
Agent Context Test
~/work/example

                                     codex    claude
Applied project surfaces                 1         0
Available project skills                 0         0
Warnings                                 0         0

Project sources
  codex
    ✓ AGENTS.md applied · instruction
  claude
    no supported project context found

Project differences
  · surface AGENTS.md only in codex
```

## What it catches

- An instruction file that one agent loads and another misses
- A nested override or fallback file that changes the effective Codex instructions
- A Claude import that is broken, conditional, excluded, or outside the project
- A required skill that is available to only one agent
- Task guidance that is missing from the context a supported agent can discover
- Private or irrelevant context that a task should not receive

Without a contract, the report shows project context and cross-agent differences. User-wide instructions and skills are summarized so they do not bury the project result. Use `--scope all` when you want the full environment comparison.

## Test the context for a task

Add `.context-tests.yml` to your repository:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/gomzkov/agent-context-test/main/schema/context-tests.v1.schema.json
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

  - id: private-notes
    expect: unavailable
    source: "personal/**"
```

Run the same command again:

```bash
npx @gomzkov/agent-context-test
```

Each assertion gets a `PASS`, `FAIL`, or `UNKNOWN` result for every target. Failed checks explain what is missing and suggest a safe place to fix it. `UNKNOWN` means the static inspector found conditional context or could not inspect enough evidence to make a trustworthy claim.

The tool finds the nearest `.context-tests.yml` between the current directory and the Git root. You can also pass a different file with `--contract`.

`contains` checks are case-sensitive after whitespace and line-ending normalization. `source` supports `*`, `**`, and `?` globs relative to the Git root. Unknown contract keys fail the run, so typos do not silently skip a check. The optional first comment enables completion and validation in editors that support YAML language-server schemas.

## Use it in CI

Commit the contract and run:

```yaml
- run: npx @gomzkov/agent-context-test@0.1.0 --no-color
```

Exit codes:

- `0`: inspection completed with no failed assertions
- `1`: one or more assertions failed
- `2`: the request or contract was invalid, so no trustworthy report was produced

## CLI

```text
context-test [directory] [options]

Options:
  --contract <path>                  Use a context contract
  --target <codex|claude>            Inspect one target; repeatable
  --scope <project|user|all>         Detail scope for terminal/Markdown (default: project)
  --format <terminal|markdown|json>  Output format
  --output <path>                    Write the report to a file
  --home <path>                      Override the home directory (tests/CI)
  --no-color                         Disable terminal colors
  -h, --help                         Show help
  -v, --version                      Show version
```

`--scope` controls terminal and Markdown detail. JSON always contains the complete discovered evidence so scripts do not lose data.

## Supported context

| Codex | Claude Code |
| --- | --- |
| `AGENTS.md` and `AGENTS.override.md` | Managed, user, project, local, and nested `CLAUDE.md` files |
| Configured fallback filenames and byte limits | `@imports`, including cycles and missing files |
| User, project, nested, and managed Agent Skills | Always-on and path-scoped `.claude/rules/` |
| Skills disabled in `config.toml` | Auto memory, Claude Skills, and legacy commands |
| `CODEX_HOME` overrides | `claudeMdExcludes` and managed `claudeMd` settings |

The adapters follow the documented local discovery behavior for [Codex instruction files](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code memory](https://code.claude.com/docs/en/memory), and [Claude Code skills](https://code.claude.com/docs/en/skills).

## Limits and privacy

This is static inspection. Runtime flags, hooks, plugins, MCP responses, prompts, added directories, and hidden system instructions can add context the tool cannot see. A static `PASS` means supported local surfaces contain the expected evidence. It does not guarantee that a model will follow an instruction.

Inspection does not execute agent files, call an AI model, send telemetry, or change agent configuration. The tool writes only when you explicitly use `--output`. Reports contain paths, fingerprints, and text you placed in the contract, not arbitrary instruction contents. Review Markdown or JSON reports before sharing them because paths and assertion text can still be private.

Version `0.x` supports Codex and Claude Code. The contract and JSON report schemas may change before `1.0`.

## Development

```bash
npm install
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Security reports belong in [GitHub private vulnerability reporting](https://github.com/gomzkov/agent-context-test/security/advisories/new), not a public issue.

MIT
