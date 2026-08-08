# Releasing

The first npm release is published locally because npm requires an existing package before trusted publishing can be configured. Later releases can use the manual GitHub Actions workflow.

## First release

For `0.1.0`:

1. Make the GitHub repository public and confirm CI passes on `main`.
2. Run `npm login` and confirm the account with `npm whoami`.
3. Run `npm publish --access public` and complete npm's 2FA prompt.
4. Confirm the package page, provenance, install command, and `context-test --version`.
5. In the npm package settings, add a [GitHub Actions trusted publisher](https://docs.npmjs.com/trusted-publishers/) for repository `gomzkov/agent-context-test` and workflow `publish.yml`.
6. Publish the prepared `v0.1.0` GitHub release.

The GitHub release does not trigger npm publishing. The publish workflow runs only when a maintainer starts it with a specific existing tag.

## Later releases

1. Update `version` in `package.json` and `package-lock.json`.
2. Move the new entries in `CHANGELOG.md` under the release version.
3. Run `npm test`, `npm pack --dry-run`, and `git diff --check`.
4. Merge the release commit to `main` and wait for CI.
5. Tag that exact commit as `v<version>`.
6. Run the `Publish to npm` workflow with that tag and confirm it succeeds.
7. Publish the matching GitHub release.
8. Confirm the package provenance, install command, and `context-test --version`.

The workflow refuses to publish when the selected tag and `package.json` version do not match.
