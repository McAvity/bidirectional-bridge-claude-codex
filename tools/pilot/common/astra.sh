#!/usr/bin/env bash
# Operator launcher for a pilot manager (Astra = Codex). Changes nothing in ~/.codex: the bridge
# MCP server and project trust are passed as per-invocation `-c` overrides; the user's own Codex
# configuration (model, approvals, auto-review) is used as in daily work. PILOT_DIR (required) is the
# run directory created by a scenario setup; CODEX_PROFILE optionally selects a Codex profile.
#
#   operator/astra.sh check    show the effective bridge definition (`codex mcp list`), no model call
#   operator/astra.sh start    open Astra's Codex TUI in the pilot repo (then paste START-ASTRA.md)
#   operator/astra.sh resume   reopen the unique top-level Astra session of the pilot repo (after a restart)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PILOT="$(cd "${PILOT_DIR:?set PILOT_DIR to the run directory}" && pwd)"
REPO="$PILOT/repo"
CODEX_BIN="${CODEX_BIN:-$(PATH="$PATH" command -v codex)}"
PROFILE_ARGS=()
if [ -n "${CODEX_PROFILE:-}" ]; then PROFILE_ARGS=(--profile "$CODEX_PROFILE"); fi
mapfile -d '' OVERRIDES < <(python3 "$HERE/codex_args.py" args "$REPO")
# Turn notifications go to the logs of the selected test directory (PILOT_DIR), not always pilot/.
NOTIFY="notify=[\"env\", \"PILOT_NOTIFY_LOG=$PILOT/logs/codex-notify.jsonl\", \"bash\", \"$HERE/notify.sh\"]"
COMMON=("${PROFILE_ARGS[@]}" -c "$NOTIFY" "${OVERRIDES[@]}")
# Optional, this invocation only: ASTRA_EFFORT=medium|high overrides the profile's reasoning effort.
if [ -n "${ASTRA_EFFORT:-}" ]; then COMMON+=(-c "model_reasoning_effort=\"$ASTRA_EFFORT\""); fi

case "${1:-}" in
  check)
    cd "$REPO"
    exec "$CODEX_BIN" "${COMMON[@]}" mcp list
    ;;
  start)
    cd "$REPO"
    echo "$(date -Is) start" >> "$PILOT/logs/operator.log"
    exec "$CODEX_BIN" "${COMMON[@]}" -C "$REPO"
    ;;
  resume)
    cd "$REPO"
    SESSION="$(python3 "$HERE/codex_args.py" session "$REPO")"
    echo "$(date -Is) resume $SESSION" >> "$PILOT/logs/operator.log"
    exec "$CODEX_BIN" "${COMMON[@]}" resume "$SESSION"
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 2
    ;;
esac
