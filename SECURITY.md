# Security

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/gomzkov/agent-context-test/security/advisories/new). Do not open a public issue for a vulnerability or include private context files in a report.

Include the affected version, a small reproduction, and the impact. Replace private paths, instruction text, tokens, and credentials with synthetic values.

## Supported versions

Security fixes are made on the latest published `0.x` release. Upgrade to the newest version before reporting a problem that may already be fixed.

## What the tool touches

Agent Context Test reads supported local instruction, settings, memory, rule, and skill files. It does not execute those files, call an AI model, or send telemetry. It writes only a report path explicitly provided with `--output`.

Terminal reports contain file paths and contract-provided text. JSON reports also contain fingerprints and structured evidence. Treat reports as potentially private and review them before sharing.
