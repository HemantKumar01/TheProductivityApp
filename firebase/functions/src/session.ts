import { DateTime } from "luxon";

export type FocusSource = "android" | "desktop" | "schedule";

export interface ScheduleData {
  enabled: boolean;
  weekdays: number[];
  localTime: string;
  timeZone: string;
  durationMinutes: number;
  lastMaterializedDate?: string;
}

export function validateDuration(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 5 || Number(value) > 480) {
    throw new Error("Duration must be a whole number from 5 to 480 minutes.");
  }
  return Number(value);
}

export function dueLocalDate(schedule: ScheduleData, now: Date): string | null {
  if (!schedule.enabled || !DateTime.local().setZone(schedule.timeZone).isValid) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)) return null;

  const localNow = DateTime.fromJSDate(now, { zone: "utc" }).setZone(schedule.timeZone);
  if (!schedule.weekdays.includes(localNow.weekday)) return null;

  const [hour, minute] = schedule.localTime.split(":").map(Number);
  const due = localNow.set({ hour, minute, second: 0, millisecond: 0 });
  const lateness = localNow.diff(due, "minutes").minutes;
  if (lateness < 0 || lateness >= 2) return null;

  const date = localNow.toISODate();
  return date && date !== schedule.lastMaterializedDate ? date : null;
}

