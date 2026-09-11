#!/usr/bin/env bash
# Codex `notify` hook for the pilot: Codex calls it with a JSON payload as the last argument
# when Astra finishes a turn. It only records the event and shows a desktop notification.
# PILOT_NOTIFY_LOG overrides the log path and PILOT_NOTIFY_DRY=1 skips the desktop popup
# (both used only by preflight).
LOG="${PILOT_NOTIFY_LOG:-/dev/null}"
printf '{"at":"%s","payload":%s}\n' "$(date -Is)" "${!#:-null}" >> "$LOG"
if [ "${PILOT_NOTIFY_DRY:-0}" != 1 ] && command -v notify-send >/dev/null 2>&1; then
  notify-send "Astra — pilot" "Astra zakończyła turę. Sprawdź, czy czeka na Twoją decyzję." || true
fi
