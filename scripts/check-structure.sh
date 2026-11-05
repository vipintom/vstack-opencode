#!/usr/bin/env bash
# Recorder structural gate: 6 tools, no execution APIs, no stale refs.
# Mirrors workspace docker/test.sh plugin_checks logic; runs repo-local.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src"

tools="$(grep -o '"vstack_[a-z_]*"' "$SRC/tools/index.ts" | sort -u | wc -l | tr -d ' ')"
[ "$tools" -eq 6 ] || { echo "FAIL recorder tools=$tools, expected 6"; exit 1; }

if grep -RIn "child_process\|spawnSync\|spawn(\|execSync\|execFile\|exec(\|Bun\.spawn" "$SRC"; then
  echo "FAIL recorder executes project commands"
  exit 1
fi

if grep -RIn "docs/deliveries" "$SRC"; then
  echo "FAIL recorder still references docs/deliveries"
  exit 1
fi

echo "recorder: 6 tools, no project execution, .vstack paths"
