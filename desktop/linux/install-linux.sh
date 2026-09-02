#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -- "$0" "$@"
fi

for dependency in /usr/sbin/dnsmasq /usr/sbin/ip /usr/bin/resolvectl /run/systemd/resolve/resolv.conf; do
  if [[ ! -e "${dependency}" ]]; then
    echo "Missing required resolver dependency: ${dependency}" >&2
    echo "On Ubuntu/Linux Mint, install dnsmasq-base, iproute2, and systemd-resolved." >&2
    exit 1
  fi
done

install -d -m 0755 /usr/local/lib/deep-focus
install -d -m 0755 /var/lib/deep-focus
install -m 0755 "${SCRIPT_DIR}/deep-focus-hosts-daemon.py" /usr/local/lib/deep-focus/deep-focus-hosts-daemon.py
install -m 0644 "${SCRIPT_DIR}/deep-focus-hosts.service" /etc/systemd/system/deep-focus-hosts.service
systemctl daemon-reload
systemctl enable deep-focus-hosts.service
systemctl restart deep-focus-hosts.service

echo "Deep Focus Linux blocker installed and running."
