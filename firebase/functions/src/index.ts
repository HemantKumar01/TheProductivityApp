import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { dueLocalDate, FocusSource, ScheduleData, validateDuration } from "./session";

initializeApp();
const db = getFirestore();

export const startFocus = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before starting focus.");

  let durationMinutes: number;
  try {
    durationMinutes = validateDuration(request.data?.durationMinutes);
  } catch (error) {
    throw new HttpsError("invalid-argument", (error as Error).message);
  }

  const source = request.data?.source as FocusSource;
  if (source !== "android" && source !== "desktop") {
    throw new HttpsError("invalid-argument", "Source must be android or desktop.");
  }

  const uid = request.auth.uid;
  const userRef = db.doc(`users/${uid}`);
  const sessions = userRef.collection("sessions");
  const lockRef = userRef.collection("internal").doc("sessionLock");
  const now = Timestamp.now();

  return db.runTransaction(async (transaction) => {
    const lock = await transaction.get(lockRef);
    const activeUntil = lock.get("activeUntil") as Timestamp | undefined;
    const activeSessionId = lock.get("activeSessionId") as string | undefined;
    if (activeUntil && activeUntil.toMillis() > now.toMillis() && activeSessionId) {
      return { sessionId: activeSessionId, startsAtMillis: lock.get("startsAt").toMillis(), endsAtMillis: activeUntil.toMillis() };
    }

    const sessionRef = sessions.doc();
    const endsAt = Timestamp.fromMillis(now.toMillis() + durationMinutes * 60_000);
    transaction.set(sessionRef, { startsAt: now, endsAt, source, createdAt: FieldValue.serverTimestamp() });
    transaction.set(lockRef, { activeSessionId: sessionRef.id, startsAt: now, activeUntil: endsAt }, { merge: true });
    transaction.set(userRef, { lastFocusAt: now }, { merge: true });
    return { sessionId: sessionRef.id, startsAtMillis: now.toMillis(), endsAtMillis: endsAt.toMillis() };
  });
});

export const materializeSchedules = onSchedule({ schedule: "every 1 minutes", region: "asia-south1" }, async () => {
  const now = new Date();
  const snapshots = await db.collectionGroup("schedules").where("enabled", "==", true).get();

  await Promise.all(snapshots.docs.map(async (scheduleDoc) => {
    try {
    const data = scheduleDoc.data() as ScheduleData;
    const localDate = dueLocalDate(data, now);
    if (!localDate) return;

    const userRef = scheduleDoc.ref.parent.parent;
    if (!userRef) return;
    const lockRef = userRef.collection("internal").doc("sessionLock");

    await db.runTransaction(async (transaction) => {
      const freshSchedule = await transaction.get(scheduleDoc.ref);
      const freshData = freshSchedule.data() as ScheduleData | undefined;
      if (!freshData || dueLocalDate(freshData, now) !== localDate) return;

      const lock = await transaction.get(lockRef);
      const startsAt = Timestamp.fromDate(now);
      const endsAt = Timestamp.fromMillis(startsAt.toMillis() + validateDuration(freshData.durationMinutes) * 60_000);
      const activeUntil = lock.get("activeUntil") as Timestamp | undefined;

      if (!activeUntil || activeUntil.toMillis() <= startsAt.toMillis()) {
        const sessionRef = userRef.collection("sessions").doc();
        transaction.set(sessionRef, {
          startsAt,
          endsAt,
          source: "schedule",
          scheduleId: scheduleDoc.id,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.set(lockRef, { activeSessionId: sessionRef.id, startsAt, activeUntil: endsAt }, { merge: true });
      }

      transaction.update(scheduleDoc.ref, { lastMaterializedDate: localDate, lastMaterializedAt: FieldValue.serverTimestamp() });
    });
    } catch (error) {
      logger.error("Schedule could not be materialized", { schedule: scheduleDoc.ref.path, error });
    }
  }));

  logger.info("Schedule sweep complete", { checked: snapshots.size });
});
