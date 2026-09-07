"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const session_1 = require("./session");
(0, node_test_1.default)("validates focus duration bounds", () => {
    strict_1.default.equal((0, session_1.validateDuration)(45), 45);
    strict_1.default.throws(() => (0, session_1.validateDuration)(4));
    strict_1.default.throws(() => (0, session_1.validateDuration)(481));
    strict_1.default.throws(() => (0, session_1.validateDuration)(20.5));
});
(0, node_test_1.default)("materializes a schedule in its own timezone once", () => {
    const schedule = {
        enabled: true,
        weekdays: [2],
        localTime: "09:30",
        timeZone: "Asia/Kolkata",
        durationMinutes: 60,
    };
    const now = new Date("2026-09-01T04:00:30.000Z");
    strict_1.default.equal((0, session_1.dueLocalDate)(schedule, now), "2026-09-01");
    strict_1.default.equal((0, session_1.dueLocalDate)({ ...schedule, lastMaterializedDate: "2026-09-01" }, now), null);
});
(0, node_test_1.default)("a schedule extends a shorter overlapping focus session", () => {
    strict_1.default.equal((0, session_1.scheduleExtendsFocus)(null, 2_000), true);
    strict_1.default.equal((0, session_1.scheduleExtendsFocus)(1_500, 2_000), true);
    strict_1.default.equal((0, session_1.scheduleExtendsFocus)(2_000, 2_000), false);
    strict_1.default.equal((0, session_1.scheduleExtendsFocus)(2_500, 2_000), false);
});
//# sourceMappingURL=session.test.js.map