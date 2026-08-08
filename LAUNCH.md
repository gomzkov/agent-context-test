# Launch checklist

The code and repository files are ready. Stop here until you want the project to become public.

## Make the repository public

1. Create `gomzkov/agent-context-test` on GitHub as a public repository. Do not add a README, license, or `.gitignore` in the GitHub form.
2. Add the GitHub remote and push `main`.
3. Set the repository description to: `Test whether Codex and Claude can find the instructions and skills a task needs.`
4. Add these topics: `ai-agents`, `codex`, `claude-code`, `agents-md`, `developer-tools`, `context-engineering`, `cli`, `testing`.
5. Enable Issues and private vulnerability reporting.
6. Require the CI checks for Node 20, 22, and 24 before merging to `main`.
7. Wait for the first public CI run and check that the README badge is green.

## Publish 0.1.0

Follow [RELEASING.md](./RELEASING.md). The first npm release uses a short-lived token; later releases use npm trusted publishing with OIDC.

After publishing, verify from a directory outside this repository:

```bash
npx @gomzkov/agent-context-test --version
npx @gomzkov/agent-context-test --help
```

## Record the demo

Run:

```bash
./scripts/demo.sh
```

Record only the command and report. Keep it under 20 seconds and make sure the `PASS`/`FAIL` matrix and suggested fix are readable. Upload the recording to the GitHub README before posting elsewhere.

## Suggested launch copy

### GitHub description

> Test whether Codex and Claude can find the instructions and skills a task needs.

### Show HN title

> Show HN: Agent Context Test – check what Codex and Claude load

### Short post

> Codex and Claude load repository instructions differently. I built a small local CLI that shows those differences and lets you add deterministic context checks to CI.
>
> It catches missing instructions, one-agent-only skills, broken Claude imports, Codex overrides, and context that should not be available for a task.
>
> No model calls and no uploads.
>
> `npx @gomzkov/agent-context-test`

Use the demo output as the main proof. Do not lead with a feature list or a context-engineering essay.

## First-week follow-up

1. Turn every incorrect discovery report into a synthetic regression fixture.
2. Ask issue reporters which agent and file layout produced the mismatch.
3. Keep the first release focused on Codex and Claude correctness.
4. Add another agent only when its discovery behavior is documented and requested by real users.
5. Track installs, stars, issue quality, and repeated requests. Do not add telemetry to the CLI.
