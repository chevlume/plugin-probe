#!/usr/bin/env bash
# Real probe runs for --strict. Does not invent host output.
set -euo pipefail

cd "$(dirname "$0")/.."
NODE="$(command -v node)"
CLI="dist/cli.js"
if [[ ! -f "$CLI" ]]; then
  echo "dist/cli.js is missing. Run npm ci or npm run build."
  exit 1
fi

SAVED_PATH="${PATH}"
EMPTY="$(mktemp -d)"
OUT="$(mktemp -d)"
trap 'rm -rf "$EMPTY" "$OUT"' EXIT

echo "claude: $(command -v claude || echo 'not on PATH')"
echo "codex: $(command -v codex || echo 'not on PATH')"

probe() {
  local path_dir="$1"
  shift
  PATH="$path_dir" "$NODE" "$CLI" "$@"
}

probe "$EMPTY" probe --hosts claude --timeout 1000 >"$OUT/plain.txt" 2>"$OUT/plain.err"
probe "$EMPTY" probe --hosts claude --timeout 1000 --json >"$OUT/plain.json" 2>"$OUT/plain-json.err"

set +e
probe "$EMPTY" probe --hosts claude --timeout 1000 --strict >"$OUT/strict.txt" 2>"$OUT/strict.err"
strict_status=$?
set -e
if [[ "$strict_status" -eq 0 ]]; then
  echo "expected non-zero exit for --strict when the host is skipped"
  exit 1
fi
if [[ "$strict_status" -ne 3 ]]; then
  echo "expected exit 3 for --strict, got ${strict_status}"
  cat "$OUT/strict.err"
  exit 1
fi

set +e
probe "$EMPTY" probe --hosts claude --timeout 1000 --strict --json >"$OUT/strict.json" 2>"$OUT/strict-json.err"
strict_json_status=$?
set -e
if [[ "$strict_json_status" -eq 0 ]]; then
  echo "expected non-zero exit for --strict --json when the host is skipped"
  exit 1
fi
if [[ "$strict_json_status" -ne 3 ]]; then
  echo "expected exit 3 for --strict --json, got ${strict_json_status}"
  exit 1
fi

if ! cmp -s "$OUT/plain.txt" "$OUT/strict.txt"; then
  echo "text stdout differs between the default run and --strict"
  diff -u "$OUT/plain.txt" "$OUT/strict.txt" || true
  exit 1
fi
if [[ -s "$OUT/plain.err" || -s "$OUT/plain-json.err" ]]; then
  echo "default run wrote stderr"
  exit 1
fi
grep -q '^plugin-probe: --strict:' "$OUT/strict.err"
grep -q '^plugin-probe: --strict:' "$OUT/strict-json.err"

"$NODE" --input-type=module -e '
import { readFileSync } from "node:fs";
const load = (file) => {
  const report = JSON.parse(readFileSync(file, "utf8"));
  if (report.ok !== true || report.schemaVersion !== 1) {
    console.error("report schema changed");
    process.exit(1);
  }
  delete report.generatedAt;
  return JSON.stringify(report);
};
const left = load(process.argv[1]);
const right = load(process.argv[2]);
if (left !== right) {
  console.error("JSON differs between a default run and --strict");
  process.exit(1);
}
const report = JSON.parse(left);
for (const host of report.hosts) {
  if (host.status !== "skipped") process.exit(1);
  for (const capability of host.capabilities) {
    if (capability.status !== "skipped") process.exit(1);
  }
}
' "$OUT/plain.json" "$OUT/strict.json"

echo "scenario=skipped flags=(none) exit=0 json=n/a stdout_matches_strict=yes"
echo "scenario=skipped flags=--json exit=0 json=valid identical_to_strict=yes"
echo "scenario=skipped flags=--strict exit=${strict_status} stdout_identical=yes"
echo "scenario=skipped flags=--strict --json exit=${strict_json_status} json_valid=yes identical=yes"

if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  cat <<'EOF'
NOT RUN: all-pass, failing hook, ignored hook.
Reason: neither the claude CLI nor the codex CLI is on PATH. plugin-probe reports yes, no, or ignored only after that host process runs. This job does not substitute another binary.
EOF
  exit 0
fi

echo "A host CLI is on PATH. Checking that --strict matches the statuses it actually reports."
hosts=()
if command -v claude >/dev/null 2>&1; then hosts+=(claude); fi
if command -v codex >/dev/null 2>&1; then hosts+=(codex); fi
plugins=(
  "test/fixtures/declared"
  "test/fixtures/undeclared"
)
for host in "${hosts[@]}"; do
  for plugin in "${plugins[@]}"; do
    label="${host}-$(basename "$plugin")"
    PATH="$SAVED_PATH" "$NODE" "$CLI" probe --hosts "$host" --timeout 20000 --json "$plugin" >"$OUT/${label}.json"
    expect="$("$NODE" --input-type=module -e '
      import { readFileSync } from "node:fs";
      const report = JSON.parse(readFileSync(process.argv[1], "utf8"));
      let fail = false;
      const bits = [];
      for (const host of report.hosts) {
        for (const capability of host.capabilities) {
          bits.push(capability.id + "=" + capability.status);
          if (capability.status !== "yes") fail = true;
        }
      }
      process.stdout.write((fail ? "3" : "0") + " " + bits.join(","));
    ' "$OUT/${label}.json")"
    expect_code="${expect%% *}"
    echo "real host=${host} plugin=${plugin} statuses=${expect#*} expected_strict=${expect_code}"
    set +e
    PATH="$SAVED_PATH" "$NODE" "$CLI" probe --hosts "$host" --timeout 20000 --strict "$plugin" >"$OUT/${label}.txt" 2>"$OUT/${label}.err"
    got=$?
    set -e
    if [[ "$got" -ne "$expect_code" ]]; then
      echo "strict exit ${got} did not match statuses (expected ${expect_code})"
      exit 1
    fi
    if [[ "$expect_code" -eq 0 ]]; then
      :
    elif [[ "$got" -eq 0 ]]; then
      echo "expected non-zero --strict for ${label}"
      exit 1
    fi
  done
done
