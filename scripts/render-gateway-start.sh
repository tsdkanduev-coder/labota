#!/bin/sh
set -e

PORT_VALUE="${PORT:-8080}"
MAX_OLD_SPACE_MB="${OPENCLAW_MAX_OLD_SPACE_MB:-384}"

if [ -n "${NODE_OPTIONS:-}" ]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --max-old-space-size=${MAX_OLD_SPACE_MB}"
else
  export NODE_OPTIONS="--max-old-space-size=${MAX_OLD_SPACE_MB}"
fi

exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port "$PORT_VALUE"
