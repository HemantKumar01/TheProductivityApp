import type { FocusSession } from "./types";

type Interval = { start: number; end: number };

export function mergeSessions(sessions: FocusSession[]): Interval[] {
  const ordered = sessions
    .map((session) => ({ start: session.startsAtMillis, end: session.endsAtMillis }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  return ordered.reduce<Interval[]>((merged, current) => {
    const previous = merged.at(-1);
    if (!previous || current.start > previous.end) merged.push({ ...current });
    else previous.end = Math.max(previous.end, current.end);
    return merged;
  }, []);
}

export function metricsFor(sessions: FocusSession[], now: number, dayStart: number) {
  const intervals = mergeSessions(sessions);
  const dayEnd = dayStart + 86_400_000;
  const focusTodayMs = intervals.reduce((total, interval) => {
    const overlap = Math.max(0, Math.min(interval.end, Math.min(now, dayEnd)) - Math.max(interval.start, dayStart));
    return total + overlap;
  }, 0);
  const active = intervals.find((interval) => interval.start <= now && interval.end > now);
  const completedSessions = sessions.filter((session) => session.endsAtMillis <= now);
  const longestMs = intervals.reduce((longest, interval) => Math.max(longest, interval.end - interval.start), 0);
  return {
    focusTodayMs,
    continuousMs: active ? now - active.start : 0,
    longestMs,
    completedCount: completedSessions.length,
    activeUntil: active?.end ?? null,
  };
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes.toString().padStart(2, "0")}m` : `${minutes}m`;
}

