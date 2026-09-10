#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOKS="$ROOT/.git/hooks"
SRC="$ROOT/scripts/git-hooks"
mkdir -p "$HOOKS"
install -m 0755 "$SRC/pre-commit" "$HOOKS/pre-commit"
install -m 0755 "$SRC/pre-push" "$HOOKS/pre-push"
echo "Installed pre-commit and pre-push (600-line gate)."
