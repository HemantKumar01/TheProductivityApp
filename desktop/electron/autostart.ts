import path from "node:path";

export const AUTOSTART_FILE_NAME = "deep-focus.desktop";

export function quoteDesktopExecArgument(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("`", "\\`").replaceAll("$", "\\$")}"`;
}

export function buildLinuxAutostartEntry(command: string[]): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Deep Focus",
    "Comment=Keep focus sessions synchronized and enforced",
    "Icon=deep-focus",
    `Exec=${command.map(quoteDesktopExecArgument).join(" ")}`,
    "Terminal=false",
    "NoDisplay=true",
    "Hidden=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export function linuxAutostartPath(homeDirectory: string, xdgConfigHome?: string): string {
  const configDirectory = xdgConfigHome && path.isAbsolute(xdgConfigHome)
    ? xdgConfigHome
    : path.join(homeDirectory, ".config");
  return path.join(configDirectory, "autostart", AUTOSTART_FILE_NAME);
}
