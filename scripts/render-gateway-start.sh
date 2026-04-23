#!/bin/sh
set -e

PORT_VALUE="${PORT:-8080}"
MAX_OLD_SPACE_MB="${OPENCLAW_MAX_OLD_SPACE_MB:-384}"
CONTROL_UI_DISABLE_DEVICE_AUTH="${OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH:-}"
DEFAULT_MODEL="${OPENCLAW_DEFAULT_MODEL:-}"
STATE_DIR_VALUE="${OPENCLAW_STATE_DIR:-${OPENCLAW_HOME:-$HOME}/.openclaw}"
CONFIG_PATH_VALUE="${OPENCLAW_CONFIG_PATH:-$STATE_DIR_VALUE/openclaw.json}"
MAIN_AGENT_DIR="$STATE_DIR_VALUE/agents/main/agent"
CURRENT_AUTH_STORE_PATH="$MAIN_AGENT_DIR/auth-profiles.json"
CURRENT_LEGACY_AUTH_PATH="$MAIN_AGENT_DIR/auth.json"

auth_store_has_credentials() {
  node - "$1" <<'JS'
const fs = require("node:fs");
const pathname = process.argv[2];
if (!pathname || !fs.existsSync(pathname)) {
  process.exit(1);
}
try {
  const raw = JSON.parse(fs.readFileSync(pathname, "utf8"));
  if (!raw || typeof raw !== "object") {
    process.exit(1);
  }
  const profiles = raw.profiles;
  if (profiles && typeof profiles === "object" && Object.keys(profiles).length > 0) {
    process.exit(0);
  }
  const legacyEntries = Object.entries(raw).filter(([key, value]) => {
    if (key === "profiles" || !value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    return (
      value.type === "api_key" ||
      value.type === "oauth" ||
      value.type === "token"
    );
  });
  process.exit(legacyEntries.length > 0 ? 0 : 1);
} catch {
  process.exit(1);
}
JS
}

recover_auth_store() {
  if auth_store_has_credentials "$CURRENT_AUTH_STORE_PATH"; then
    return 0
  fi

  LEGACY_AUTH_STORE_PATHS="
$STATE_DIR_VALUE/agent/auth-profiles.json
$STATE_DIR_VALUE/agent/auth.json
$STATE_DIR_VALUE/auth-profiles.json
$STATE_DIR_VALUE/auth.json
"

  for legacy_path in $LEGACY_AUTH_STORE_PATHS; do
    if ! auth_store_has_credentials "$legacy_path"; then
      continue
    fi
    mkdir -p "$MAIN_AGENT_DIR"
    case "$legacy_path" in
      */auth.json)
        cp "$legacy_path" "$CURRENT_LEGACY_AUTH_PATH"
        echo "Recovered legacy auth store: $legacy_path -> $CURRENT_LEGACY_AUTH_PATH"
        ;;
      *)
        cp "$legacy_path" "$CURRENT_AUTH_STORE_PATH"
        echo "Recovered auth profiles: $legacy_path -> $CURRENT_AUTH_STORE_PATH"
        ;;
    esac
    return 0
  done

  return 1
}

recover_auth_store || true

if [ -n "$DEFAULT_MODEL" ]; then
  mkdir -p "$(dirname "$CONFIG_PATH_VALUE")"
  CONFIG_PATH="$CONFIG_PATH_VALUE" \
  OPENCLAW_CONFIG_PATH="$CONFIG_PATH_VALUE" \
  node openclaw.mjs config set agents.defaults.model.primary "$DEFAULT_MODEL"

  CONFIG_PATH="$CONFIG_PATH_VALUE" \
  OPENCLAW_CONFIG_PATH="$CONFIG_PATH_VALUE" \
  node openclaw.mjs config set "agents.defaults.models[$DEFAULT_MODEL]" "{}" --json
fi

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
