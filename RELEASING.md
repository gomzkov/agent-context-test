# Releasing

This project publishes `@gomzkov/agent-context-test` from GitHub Actions when a GitHub release is published.

## First release

The npm package must exist before npm trusted publishing can be attached to it. For `0.1.0`:

1. Make the GitHub repository public and confirm CI passes on `main`.
2. Create a short-lived granular npm token that can publish packages under `@gomzkov`.
3. Add it to the GitHub repository as the `NPM_TOKEN` Actions secret.
4. Create the `v0.1.0` tag from the verified commit and publish a GitHub release for it.
5. Confirm the `Publish to npm` workflow succeeds and the package provenance links back to this repository.
6. In the npm package settings, add a GitHub Actions trusted publisher for `gomzkov/agent-context-test` and workflow `publish.yml`, allowed to run `npm publish`.
7. Delete the GitHub `NPM_TOKEN` secret and revoke the npm token.
8. Enable npm's option to reject token-based publishing after the trusted publisher works.

The publish workflow uses OIDC when trusted publishing is configured. `NPM_TOKEN` is only the first-release fallback.

## Later releases

1. Update `version` in `package.json` and `package-lock.json`.
2. Move the new entries in `CHANGELOG.md` under the release version.
3. Run `npm test`, `npm pack --dry-run`, and `git diff --check`.
4. Merge the release commit to `main` and wait for CI.
5. Tag that exact commit as `v<version>` and publish the matching GitHub release.
6. Confirm the npm workflow, package provenance, install command, and `context-test --version`.

The workflow refuses to publish when the GitHub release tag and `package.json` version do not match.
