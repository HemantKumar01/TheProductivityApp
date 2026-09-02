import { describe, expect, it } from "vitest";
import { mergeSessions, metricsFor } from "./metrics";

const session = (id: string, start: number, end: number) => ({ id, startsAtMillis: start, endsAtMillis: end, source: "desktop" as const });

describe("focus metrics", () => {
  it("merges overlapping and touching sessions", () => {
    expect(mergeSessions([session("a", 0, 100), session("b", 50, 150), session("c", 150, 200)])).toEqual([{ start: 0, end: 200 }]);
  });

  it("clips today's total to now", () => {
    expect(metricsFor([session("a", 900, 2_000)], 1_500, 1_000).focusTodayMs).toBe(500);
  });
});

