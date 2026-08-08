# Agent Context Test

[![CI](https://github.com/gomzkov/agent-context-test/actions/workflows/ci.yml/badge.svg)](https://github.com/gomzkov/agent-context-test/actions/workflows/ci.yml)

Test whether Codex and Claude can find the instructions and skills a task needs.

```bash
npx @gomzkov/agent-context-test
```

It reads local agent configuration, compares what each agent can discover, and makes no model calls or uploads.

## See the mismatch

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

It catches:

- An instruction file that one agent loads and another misses
- A nested override or fallback file that changes the effective Codex instructions
- A Claude import that is broken, conditional, excluded, or outside the project
- A required skill that is available to only one agent
- Task guidance that is missing from the context a supported agent can discover
- Private or irrelevant context that a task should not receive

Without a contract, the report puts project context first and summarizes user-wide context. Use `--scope all` for the complete environment comparison.

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

Each assertion gets `PASS`, `FAIL`, or `UNKNOWN` for every target. A failed check explains what is missing and where to fix it. `UNKNOWN` means the available static evidence is conditional or incomplete.

The tool finds the nearest `.context-tests.yml` up to the Git root. Pass another file with `--contract`. The optional schema comment enables validation and completion in compatible editors.

## Use it in CI

Commit the contract and run:

```yaml
- run: npx @gomzkov/agent-context-test@0.1.0 --no-color
```

Exit codes:

- `0`: inspection completed with no failed assertions
- `1`: one or more assertions failed
- `2`: the request or contract was invalid, so no trustworthy report was produced

## Useful options

```text
context-test [directory]
  --contract <path>
  --target <codex|claude>
  --scope <project|user|all>
  --format <terminal|markdown|json>
  --output <path>
```

Run `context-test --help` for the full reference. JSON always contains the complete discovered evidence.

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

This is static inspection. Runtime flags, hooks, plugins, MCP responses, prompts, and hidden instructions can add context the tool cannot see. A static `PASS` means supported local surfaces contain the expected evidence. It does not guarantee that a model will follow an instruction.

The tool does not execute agent files, send telemetry, or change agent configuration. It writes only with `--output`. Reports omit arbitrary instruction contents, but paths and contract text can still be private. Review reports before sharing them.

Version `0.x` supports Codex and Claude Code. The contract and JSON report schemas may change before `1.0`.

## Development

```bash
npm install
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Report security issues through [GitHub private vulnerability reporting](https://github.com/gomzkov/agent-context-test/security/advisories/new).

MIT
