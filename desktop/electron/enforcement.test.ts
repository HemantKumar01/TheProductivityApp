import { describe, expect, it } from "vitest";
import { enforcementEndpoint, enforcementUnavailableMessage } from "./enforcement";

describe("desktop enforcement routing", () => {
  it("uses the Windows named pipe", () => {
    expect(enforcementEndpoint("win32", {})).toBe("\\\\.\\pipe\\deep-focus");
  });

  it("uses the configured Linux socket", () => {
    expect(enforcementEndpoint("linux", { DEEP_FOCUS_SOCKET: "/tmp/focus.sock" })).toBe("/tmp/focus.sock");
  });

  it("reports platform-specific setup failures", () => {
    expect(enforcementUnavailableMessage("win32")).toContain("administrator");
    expect(enforcementUnavailableMessage("linux")).toContain("Linux installer");
  });
});
