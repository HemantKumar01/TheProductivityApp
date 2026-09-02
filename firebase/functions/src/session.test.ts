import test from "node:test";
import assert from "node:assert/strict";
import { dueLocalDate, validateDuration } from "./session";

test("validates focus duration bounds", () => {
  assert.equal(validateDuration(45), 45);
  assert.throws(() => validateDuration(4));
  assert.throws(() => validateDuration(481));
  assert.throws(() => validateDuration(20.5));
});

test("materializes a schedule in its own timezone once", () => {
  const schedule = {
    enabled: true,
    weekdays: [2],
    localTime: "09:30",
    timeZone: "Asia/Kolkata",
    durationMinutes: 60,
  };
  const now = new Date("2026-09-01T04:00:30.000Z");
  assert.equal(dueLocalDate(schedule, now), "2026-09-01");
  assert.equal(dueLocalDate({ ...schedule, lastMaterializedDate: "2026-09-01" }, now), null);
});

