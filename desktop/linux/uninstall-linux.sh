#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -- "$0" "$@"
fi

STATE_FILE=/var/lib/deep-focus/state.json
if [[ -f "${STATE_FILE}" ]]; then
  ENDS_AT="$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1])).get("endsAtMillis",0)))' "${STATE_FILE}")"
  NOW="$(date +%s%3N)"
  if (( ENDS_AT > NOW )); then
    echo "Cannot uninstall during an active focus session." >&2
    exit 1
  fi
fi

systemctl disable --now deep-focus-hosts.service || true
rm -f /etc/systemd/system/deep-focus-hosts.service
rm -f /usr/local/lib/deep-focus/deep-focus-hosts-daemon.py
systemctl daemon-reload
echo "Deep Focus Linux blocker uninstalled."
