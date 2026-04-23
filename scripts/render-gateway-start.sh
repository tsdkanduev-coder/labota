#!/bin/sh
set -e

PORT_VALUE="${PORT:-8080}"

exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port "$PORT_VALUE"
