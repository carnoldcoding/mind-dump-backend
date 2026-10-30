// Finances — which days a Scheduled transaction still owes (spec R26–R28).
// The catch-up runs on every read, so the two ways to get this wrong are both
// silent: a day recorded twice inflates income, a day skipped loses rent.
// (describe/it/expect are Vitest globals — see vitest.config.js.)

const { dueDates, dayBefore } = require("./schedule");

const pay = (overrides = {}) => ({ days: [1, 15], lastRecorded: "2026-09-30", ...overrides });

describe("dueDates", () => {
    it("returns each scheduled day after the last recording, up to today", () => {
        expect(dueDates(pay(), "2026-10-20")).toEqual(["2026-10-01", "2026-10-15"]);
    });

    it("includes today when today is a scheduled day", () => {
        expect(dueDates(pay(), "2026-10-15")).toEqual(["2026-10-01", "2026-10-15"]);
    });

    it("returns nothing once every due day is recorded", () => {
        expect(dueDates(pay({ lastRecorded: "2026-10-15" }), "2026-10-20")).toEqual([]);
    });

    it("catches up across several months", () => {
        expect(dueDates(pay({ lastRecorded: "2026-08-20" }), "2026-10-02"))
            .toEqual(["2026-09-01", "2026-09-15", "2026-10-01"]);
    });

    // R27: the 31st in a 30-day month lands on the 30th, and February's on
    // the 28th — not skipped, and not rolled into the next month.
    it("records a day the month lacks on its last day", () => {
        const rent = { days: [31], lastRecorded: "2026-08-31" };
        expect(dueDates(rent, "2026-11-30")).toEqual(["2026-09-30", "2026-10-31", "2026-11-30"]);
        expect(dueDates({ days: [30], lastRecorded: "2027-01-31" }, "2027-03-01")).toEqual(["2027-02-28"]);
    });

    it("records a clamped day once when two days clamp onto it", () => {
        expect(dueDates({ days: [30, 31], lastRecorded: "2027-01-31" }, "2027-02-28")).toEqual(["2027-02-28"]);
    });

    it("crosses a year boundary", () => {
        expect(dueDates({ days: [1], lastRecorded: "2026-12-01" }, "2027-01-05")).toEqual(["2027-01-01"]);
    });
});

describe("a new schedule (R28)", () => {
    // A schedule starts with lastRecorded set to the day before it was
    // created, so its creation day counts and nothing earlier does.
    it("records nothing for days before its creation date", () => {
        const created = { days: [1, 15], lastRecorded: dayBefore("2026-10-20") };
        expect(dueDates(created, "2026-10-20")).toEqual([]);
    });

    it("records its creation day when that is a scheduled day", () => {
        const created = { days: [15], lastRecorded: dayBefore("2026-10-15") };
        expect(dueDates(created, "2026-10-15")).toEqual(["2026-10-15"]);
    });

    it("steps back across month and year ends", () => {
        expect(dayBefore("2026-03-01")).toBe("2026-02-28");
        expect(dayBefore("2027-01-01")).toBe("2026-12-31");
    });
});
