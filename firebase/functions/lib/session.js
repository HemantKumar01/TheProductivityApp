"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDuration = validateDuration;
exports.dueLocalDate = dueLocalDate;
const luxon_1 = require("luxon");
function validateDuration(value) {
    if (!Number.isInteger(value) || Number(value) < 5 || Number(value) > 480) {
        throw new Error("Duration must be a whole number from 5 to 480 minutes.");
    }
    return Number(value);
}
function dueLocalDate(schedule, now) {
    if (!schedule.enabled || !luxon_1.DateTime.local().setZone(schedule.timeZone).isValid)
        return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime))
        return null;
    const localNow = luxon_1.DateTime.fromJSDate(now, { zone: "utc" }).setZone(schedule.timeZone);
    if (!schedule.weekdays.includes(localNow.weekday))
        return null;
    const [hour, minute] = schedule.localTime.split(":").map(Number);
    const due = localNow.set({ hour, minute, second: 0, millisecond: 0 });
    const lateness = localNow.diff(due, "minutes").minutes;
    if (lateness < 0 || lateness >= 2)
        return null;
    const date = localNow.toISODate();
    return date && date !== schedule.lastMaterializedDate ? date : null;
}
//# sourceMappingURL=session.js.map