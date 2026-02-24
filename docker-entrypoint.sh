#!/bin/sh
set -e

# Bootstrap workspace files from /app/workspace into the persistent
# workspace directory.  Only copies files that don't already exist so
# that user/model edits on the persistent disk are preserved.

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
mkdir -p "$WORKSPACE_DIR"

for src in /app/workspace/*; do
  [ -f "$src" ] || continue
  fname="$(basename "$src")"
  if [ ! -f "$WORKSPACE_DIR/$fname" ]; then
    cp "$src" "$WORKSPACE_DIR/$fname"
    echo "[bootstrap] Copied $fname to $WORKSPACE_DIR"
  fi
done

exec "$@"
