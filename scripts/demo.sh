#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo_root="$(mktemp -d)"
demo_home="$demo_root/home"
demo_project="$demo_root/project"

cleanup() {
  rm -rf "$demo_root"
}
trap cleanup EXIT

mkdir -p "$demo_home" "$demo_project/.git"

cat > "$demo_project/AGENTS.md" <<'EOF'
# Project instructions

- Run npm test before opening a pull request.
EOF

cat > "$demo_project/.context-tests.yml" <<'EOF'
version: 1
task: open-a-pull-request
targets: [codex, claude]

assertions:
  - id: run-tests
    expect: available
    contains: "Run npm test before opening a pull request."
EOF

cd "$project_root"
npm run build --silent

set +e
node dist/src/cli.js "$demo_project" --home "$demo_home" --no-color
status=$?
set -e

if [[ "$status" -ne 1 ]]; then
  echo "Demo expected exit code 1 but received $status" >&2
  exit 1
fi
