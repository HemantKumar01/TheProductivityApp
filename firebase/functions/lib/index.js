"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializeSchedules = exports.startFocus = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const session_1 = require("./session");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
exports.startFocus = (0, https_1.onCall)({ region: "asia-south1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in before starting focus.");
    let durationMinutes;
    try {
        durationMinutes = (0, session_1.validateDuration)(request.data?.durationMinutes);
    }
    catch (error) {
        throw new https_1.HttpsError("invalid-argument", error.message);
    }
    const source = request.data?.source;
    if (source !== "android" && source !== "desktop") {
        throw new https_1.HttpsError("invalid-argument", "Source must be android or desktop.");
    }
    const uid = request.auth.uid;
    const userRef = db.doc(`users/${uid}`);
    const sessions = userRef.collection("sessions");
    const lockRef = userRef.collection("internal").doc("sessionLock");
    const now = firestore_1.Timestamp.now();
    return db.runTransaction(async (transaction) => {
        const lock = await transaction.get(lockRef);
        const activeUntil = lock.get("activeUntil");
        const activeSessionId = lock.get("activeSessionId");
        if (activeUntil && activeUntil.toMillis() > now.toMillis() && activeSessionId) {
            return { sessionId: activeSessionId, startsAtMillis: lock.get("startsAt").toMillis(), endsAtMillis: activeUntil.toMillis() };
        }
        const sessionRef = sessions.doc();
        const endsAt = firestore_1.Timestamp.fromMillis(now.toMillis() + durationMinutes * 60_000);
        transaction.set(sessionRef, { startsAt: now, endsAt, source, createdAt: firestore_1.FieldValue.serverTimestamp() });
        transaction.set(lockRef, { activeSessionId: sessionRef.id, startsAt: now, activeUntil: endsAt }, { merge: true });
        transaction.set(userRef, { lastFocusAt: now }, { merge: true });
        return { sessionId: sessionRef.id, startsAtMillis: now.toMillis(), endsAtMillis: endsAt.toMillis() };
    });
});
exports.materializeSchedules = (0, scheduler_1.onSchedule)({ schedule: "every 1 minutes", region: "asia-south1" }, async () => {
    const now = new Date();
    const snapshots = await db.collectionGroup("schedules").where("enabled", "==", true).get();
    await Promise.all(snapshots.docs.map(async (scheduleDoc) => {
        try {
            const data = scheduleDoc.data();
            const localDate = (0, session_1.dueLocalDate)(data, now);
            if (!localDate)
                return;
            const userRef = scheduleDoc.ref.parent.parent;
            if (!userRef)
                return;
            const lockRef = userRef.collection("internal").doc("sessionLock");
            await db.runTransaction(async (transaction) => {
                const freshSchedule = await transaction.get(scheduleDoc.ref);
                const freshData = freshSchedule.data();
                if (!freshData || (0, session_1.dueLocalDate)(freshData, now) !== localDate)
                    return;
                const lock = await transaction.get(lockRef);
                const startsAt = firestore_1.Timestamp.fromDate(now);
                const endsAt = firestore_1.Timestamp.fromMillis(startsAt.toMillis() + (0, session_1.validateDuration)(freshData.durationMinutes) * 60_000);
                const activeUntil = lock.get("activeUntil");
                if (!activeUntil || activeUntil.toMillis() <= startsAt.toMillis()) {
                    const sessionRef = userRef.collection("sessions").doc();
                    transaction.set(sessionRef, {
                        startsAt,
                        endsAt,
                        source: "schedule",
                        scheduleId: scheduleDoc.id,
                        createdAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                    transaction.set(lockRef, { activeSessionId: sessionRef.id, startsAt, activeUntil: endsAt }, { merge: true });
                }
                transaction.update(scheduleDoc.ref, { lastMaterializedDate: localDate, lastMaterializedAt: firestore_1.FieldValue.serverTimestamp() });
            });
        }
        catch (error) {
            firebase_functions_1.logger.error("Schedule could not be materialized", { schedule: scheduleDoc.ref.path, error });
        }
    }));
    firebase_functions_1.logger.info("Schedule sweep complete", { checked: snapshots.size });
});
//# sourceMappingURL=index.js.map