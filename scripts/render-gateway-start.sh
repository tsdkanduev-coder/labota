#!/bin/sh
set -e

PORT_VALUE="${PORT:-8080}"
MAX_OLD_SPACE_MB="${OPENCLAW_MAX_OLD_SPACE_MB:-384}"
CONTROL_UI_DISABLE_DEVICE_AUTH="${OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH:-}"

normalize_bool() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      printf 'true'
      ;;
    0|false|no|off)
      printf 'false'
      ;;
    *)
      return 1
      ;;
  esac
}

if [ -n "$CONTROL_UI_DISABLE_DEVICE_AUTH" ]; then
  CONTROL_UI_DISABLE_DEVICE_AUTH_BOOL="$(normalize_bool "$CONTROL_UI_DISABLE_DEVICE_AUTH")"
  STATE_DIR_VALUE="${OPENCLAW_STATE_DIR:-${OPENCLAW_HOME:-$HOME}/.openclaw}"
  CONFIG_PATH_VALUE="${OPENCLAW_CONFIG_PATH:-$STATE_DIR_VALUE/openclaw.json}"
  mkdir -p "$(dirname "$CONFIG_PATH_VALUE")"
  CONFIG_PATH="$CONFIG_PATH_VALUE" \
  OPENCLAW_CONFIG_PATH="$CONFIG_PATH_VALUE" \
  node openclaw.mjs config set gateway.controlUi.dangerouslyDisableDeviceAuth \
    "$CONTROL_UI_DISABLE_DEVICE_AUTH_BOOL" --json
fi

if [ -n "${NODE_OPTIONS:-}" ]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --max-old-space-size=${MAX_OLD_SPACE_MB}"
else
  export NODE_OPTIONS="--max-old-space-size=${MAX_OLD_SPACE_MB}"
fi

exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port "$PORT_VALUE"
