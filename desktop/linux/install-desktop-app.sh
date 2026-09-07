#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
DESKTOP_DIR="${PROJECT_DIR}/desktop"
DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
APP_DIR="${DATA_HOME}/deep-focus"
APP_TARGET="${APP_DIR}/Deep-Focus.AppImage"
ICON_TARGET="${DATA_HOME}/icons/hicolor/256x256/apps/deep-focus.png"
MENU_ENTRY="${DATA_HOME}/applications/deep-focus.desktop"
AUTOSTART_ENTRY="${CONFIG_HOME}/autostart/deep-focus.desktop"

cd "${PROJECT_DIR}"
npm run package:linux -w @deep-focus/desktop

APP_IMAGE="$(find "${DESKTOP_DIR}/release" -maxdepth 1 -type f -name 'Deep-Focus-*.AppImage' -print -quit)"
if [[ -z "${APP_IMAGE}" ]]; then
  echo "The Deep Focus AppImage was not produced." >&2
  exit 1
fi

install -d -m 0755 "${APP_DIR}" "$(dirname -- "${ICON_TARGET}")" "$(dirname -- "${MENU_ENTRY}")" "$(dirname -- "${AUTOSTART_ENTRY}")"
install -m 0755 "${APP_IMAGE}" "${APP_TARGET}"
install -m 0644 "${DESKTOP_DIR}/assets/icon-256.png" "${ICON_TARGET}"

TEMP_ENTRY="$(mktemp)"
trap 'rm -f -- "${TEMP_ENTRY}"' EXIT
printf '%s\n' \
  '[Desktop Entry]' \
  'Type=Application' \
  'Version=1.0' \
  'Name=Deep Focus' \
  'Comment=Protect focused work across your devices' \
  "Exec=\"${APP_TARGET}\"" \
  'Icon=deep-focus' \
  'Terminal=false' \
  'Categories=Utility;Office;' \
  'StartupWMClass=deep-focus' > "${TEMP_ENTRY}"
install -m 0644 "${TEMP_ENTRY}" "${MENU_ENTRY}"

printf '%s\n' \
  '[Desktop Entry]' \
  'Type=Application' \
  'Version=1.0' \
  'Name=Deep Focus' \
  'Comment=Keep focus sessions synchronized and enforced' \
  "Exec=\"${APP_TARGET}\" --autostart" \
  'Icon=deep-focus' \
  'Terminal=false' \
  'NoDisplay=true' \
  'Hidden=false' \
  'X-GNOME-Autostart-enabled=true' > "${TEMP_ENTRY}"
install -m 0600 "${TEMP_ENTRY}" "${AUTOSTART_ENTRY}"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${DATA_HOME}/applications" >/dev/null 2>&1 || true
fi

echo "Deep Focus is installed. Open it from the application menu; it will start hidden on future Linux logins."
