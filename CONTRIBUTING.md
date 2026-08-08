# Contributing

Thanks for helping make agent context easier to inspect and test.

## Before you start

Open an issue for new agents, new context surfaces, or contract schema changes. Small bug fixes can go straight to a pull request.

Discovery behavior needs a link to the agent vendor's current documentation and a synthetic fixture that demonstrates the rule. Do not use private project files or instruction contents as test data.

## Local setup

You need Node.js 20 or newer.

```bash
npm install
npm test
```

The test command builds the TypeScript project and runs the compiled test suite.

## Code changes

- Keep Codex and Claude discovery logic in their own adapters.
- Add a regression test that fails before the fix and passes after it.
- Treat conditional or incomplete evidence as `UNKNOWN`, not `PASS` or `FAIL`.
- Do not print arbitrary instruction contents. Contract text is allowed because the user chose it for the report.
- Keep the JSON report deterministic so it can be used in CI.

Run these checks before opening a pull request:

```bash
npm test
npm pack --dry-run
git diff --check
```

## Pull requests

Keep a pull request focused on one behavior. Explain the real context problem it fixes, include the command or fixture that reproduced it, and note the vendor documentation used for discovery rules.
