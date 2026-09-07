"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTOSTART_FILE_NAME = void 0;
exports.quoteDesktopExecArgument = quoteDesktopExecArgument;
exports.buildLinuxAutostartEntry = buildLinuxAutostartEntry;
exports.linuxAutostartPath = linuxAutostartPath;
const node_path_1 = __importDefault(require("node:path"));
exports.AUTOSTART_FILE_NAME = "deep-focus.desktop";
function quoteDesktopExecArgument(value) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("`", "\\`").replaceAll("$", "\\$")}"`;
}
function buildLinuxAutostartEntry(command) {
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
function linuxAutostartPath(homeDirectory, xdgConfigHome) {
    const configDirectory = xdgConfigHome && node_path_1.default.isAbsolute(xdgConfigHome)
        ? xdgConfigHome
        : node_path_1.default.join(homeDirectory, ".config");
    return node_path_1.default.join(configDirectory, "autostart", exports.AUTOSTART_FILE_NAME);
}
