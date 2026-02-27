#!/bin/sh
set -e

# Bootstrap workspace files from /app/workspace into the persistent
# workspace directory.  Only copies files that don't already exist so
# that user/model edits on the persistent disk are preserved.
#
# Workspace path formula matches Node.js resolveDefaultAgentWorkspaceDir()
# (src/agents/workspace.ts:10-20):
#   home = OPENCLAW_HOME || HOME
#   if OPENCLAW_PROFILE && profile != "default":
#     → home/.openclaw/workspace-<profile>
#   else:
#     → home/.openclaw/workspace

HOME_DIR="${OPENCLAW_HOME:-${HOME:-/home/node}}"
PROFILE="${OPENCLAW_PROFILE:-}"
if [ -n "$PROFILE" ] && [ "$(echo "$PROFILE" | tr '[:upper:]' '[:lower:]')" != "default" ]; then
  WORKSPACE_DIR="${HOME_DIR}/.openclaw/workspace-${PROFILE}"
else
  WORKSPACE_DIR="${HOME_DIR}/.openclaw/workspace"
fi
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
