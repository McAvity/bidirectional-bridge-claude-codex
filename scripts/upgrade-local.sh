#!/usr/bin/env bash
# Run from any directory; Node resolves the installed release or this checkout's distribution pin.
set -euo pipefail
script_dir="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "$script_dir/upgrade-local.mjs" "$@"
