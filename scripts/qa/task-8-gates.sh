#!/bin/bash
run_task8_gates() {
  local gate_dir="$E/gates"; mkdir -p "$gate_dir"
  gate() { local name="$1" command="$2" code; set +e; (cd "$REPO_ROOT" && REPO_ROOT="$REPO_ROOT" bash -c "$command") >"$gate_dir/$name.stdout" 2>"$gate_dir/$name.stderr"; code=$?; set -e; jq -n --arg name "$name" --arg command "$command" --argjson exit "$code" '{name:$name,command:$command,exit:$exit,authoritative:($exit==0)}' >"$gate_dir/$name.exit.json"; [ "$code" -eq 0 ]; }
  local seven='cd "$REPO_ROOT" && umask 022 && bun test "$REPO_ROOT/packages/backend/tests/exports.test.ts" "$REPO_ROOT/packages/backend/tests/export-validation.test.ts" "$REPO_ROOT/packages/backend/tests/export-recovery.test.ts" "$REPO_ROOT/packages/backend/tests/export-pdf.test.ts" "$REPO_ROOT/packages/backend/tests/export-pptx.test.ts" "$REPO_ROOT/packages/backend/tests/export-handoff.test.ts" "$REPO_ROOT/packages/backend/tests/export-gc.test.ts"'
  local chromium='cd "$REPO_ROOT" && umask 022 && BG_EXPORT_SMOKE=1 PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" bun test "$REPO_ROOT/packages/backend/tests/exports.test.ts"'
  local affected='cd "$REPO_ROOT" && umask 022 && bun test "$REPO_ROOT/packages/backend/tests/export-render-lifecycle.test.ts" "$REPO_ROOT/packages/backend/tests/export-validation.test.ts" "$REPO_ROOT/packages/backend/tests/export-recovery.test.ts" "$REPO_ROOT/packages/backend/tests/export-gc.test.ts" "$REPO_ROOT/packages/backend/tests/exports.test.ts" "$REPO_ROOT/packages/backend/tests/artifact-routes.test.ts" "$REPO_ROOT/packages/backend/tests/artifact-anchor-routes.test.ts" "$REPO_ROOT/packages/backend/tests/migration-pipeline-upgrade.test.ts" "$REPO_ROOT/packages/backend/tests/upgrade-contracts.test.ts" "$REPO_ROOT/packages/backend/tests/serve-path-boundary.test.ts" "$REPO_ROOT/packages/backend/tests/session-routes.test.ts"'
  local full='cd "$REPO_ROOT" && umask 022 && bun test "$REPO_ROOT/packages"'
  local static='test -z "$(rg -n "as any|@ts-ignore|@ts-expect-error|TODO DEBUG|console\\.log\\(\\\"\\[DEBUG|sleep [0-9]|waitForTimeout" packages/backend/src/services/export-* packages/backend/src/db/export-* packages/backend/tests/export-* scripts/qa/task-8-* | grep -v "scripts/qa/task-8-gates.sh:" || true)"'
  local loc='test "$(wc -l packages/backend/src/db/export-lifecycle-repository.ts packages/backend/src/db/migrate-local.ts packages/backend/src/db/sequenced-event-writer.ts packages/backend/src/services/export-*.ts packages/backend/tests/export-*.ts scripts/qa/task-8-* | awk '\''$2!="total"&&$1>250{bad=1}END{print bad+0}'\'')" = 0'
  local failed=0; gate exact-seven "$seven" || failed=1; gate chromium "$chromium" || failed=1; gate affected "$affected" || failed=1; gate typecheck 'bun run typecheck' || failed=1; gate build 'bun run build:frontend && { [ "${OS:-}" != Windows_NT ] || bun run build:backend; }' || failed=1; gate full-suite "$full" || failed=1; gate diff-check 'git diff --check' || failed=1; gate static-audit "$static" || failed=1; gate loc-audit "$loc" || failed=1; return "$failed"
}


if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -u
  REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
  evidence_root="$REPO_ROOT/.omo/evidence"
  mkdir -p "$evidence_root"
  git -C "$REPO_ROOT" check-ignore -q "$evidence_root/task-8-gates.probe" || {
    printf 'task-8 evidence root is not ignored: %s\n' "$evidence_root" >&2
    exit 1
  }
  E="$(mktemp -d "$evidence_root/task-8-gates.XXXXXX")"
  export REPO_ROOT E
  printf 'TASK8_EVIDENCE=%s\n' "$E"
  run_task8_gates
fi
