import { describe, expect, it } from "vitest";
import { buildLinuxAutostartEntry, linuxAutostartPath, quoteDesktopExecArgument } from "./autostart";

describe("Linux autostart", () => {
  it("quotes desktop Exec arguments", () => {
    expect(quoteDesktopExecArgument('/opt/Deep Focus/"app"')).toBe('"/opt/Deep Focus/\\"app\\""');
  });

  it("builds a hidden graphical-session entry", () => {
    const entry = buildLinuxAutostartEntry(["/opt/deep-focus", "--autostart"]);
    expect(entry).toContain('Exec="/opt/deep-focus" "--autostart"');
    expect(entry).toContain("Icon=deep-focus");
    expect(entry).toContain("Terminal=false");
    expect(entry).toContain("X-GNOME-Autostart-enabled=true");
  });

  it("honors an absolute XDG config directory", () => {
    expect(linuxAutostartPath("/home/user", "/tmp/config")).toBe("/tmp/config/autostart/deep-focus.desktop");
    expect(linuxAutostartPath("/home/user", "relative/config")).toBe("/home/user/.config/autostart/deep-focus.desktop");
  });
});
