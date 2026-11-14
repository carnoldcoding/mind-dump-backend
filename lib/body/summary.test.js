// Body — the computed summary (spec R5). Every expected value here is worked
// out by hand from the calendar: 2026-11-09 is a Monday, 2026-11-15 the Sunday
// that ends its week.
// (describe/it/expect are Vitest globals — see vitest.config.js.)

const { weekdayOf, weekStart, addDays } = require("./dates");
const summary = require("./summary");

const plan = {
    workouts: [
        { key: "upperA", name: "Upper A", weekday: 1, slots: [] },
        { key: "lowerA", name: "Lower A", weekday: 2, slots: [] },
        { key: "upperB", name: "Upper B", weekday: 4, slots: [] },
        { key: "lowerB", name: "Lower B", weekday: 5, slots: [] },
    ],
    routine: { items: [] },
    phase: { name: "Phase 1", startLb: 245, targetLb: 216 },
};

const session = (date, workoutKey, sets = [{ id: "s", movementId: "m1", full: 5 }]) => ({
    _id: `${date}-${workoutKey}`, date, workoutKey, sets, skipped: [],
});

describe("dates", () => {
    it("numbers weekdays from Monday = 1 to Sunday = 7", () => {
        expect(weekdayOf("2026-11-09")).toBe(1);
        expect(weekdayOf("2026-11-14")).toBe(6);
        expect(weekdayOf("2026-11-15")).toBe(7);
    });

    it("finds the Monday that starts a date's week", () => {
        expect(weekStart("2026-11-09")).toBe("2026-11-09");
        expect(weekStart("2026-11-15")).toBe("2026-11-09");
        expect(weekStart("2026-11-16")).toBe("2026-11-16");
    });

    it("adds days across a month boundary", () => {
        expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
        expect(addDays("2026-11-02", -3)).toBe("2026-10-30");
    });
});

describe("today (R13, R15, R16)", () => {
    it("names the Workout planned for the weekday", () => {
        expect(summary.today(plan, [], "2026-11-09")).toMatchObject({ weekday: 1, due: "upperA", dueDone: false, missed: [] });
    });

    it("reports a rest day as no Workout due", () => {
        expect(summary.today(plan, [], "2026-11-11").due).toBeNull();
    });

    it("lists the Workouts planned earlier in the week that have no Session", () => {
        expect(summary.today(plan, [], "2026-11-11").missed).toEqual(["upperA", "lowerA"]);
    });

    it("drops a missed Workout once a Session with a Set exists for it that week", () => {
        const sessions = [session("2026-11-11", "upperA")];
        expect(summary.today(plan, sessions, "2026-11-12").missed).toEqual(["lowerA"]);
    });

    it("still counts a Workout as missed when its Session has no Set", () => {
        const sessions = [session("2026-11-11", "upperA", [])];
        expect(summary.today(plan, sessions, "2026-11-11").missed).toEqual(["upperA", "lowerA"]);
    });

    it("marks the due Workout done when its Session has a Set", () => {
        const sessions = [session("2026-11-09", "upperA")];
        expect(summary.today(plan, sessions, "2026-11-09")).toMatchObject({ due: "upperA", dueDone: true });
    });

    it("forgets last week's missed Workouts on Monday", () => {
        // Friday 2026-11-13 (Lower B) was skipped; Monday 2026-11-16 starts clean.
        expect(summary.today(plan, [], "2026-11-16")).toMatchObject({ due: "upperA", missed: [] });
    });

    it("does not count a Session from another week", () => {
        const sessions = [session("2026-11-06", "lowerB")];
        expect(summary.today(plan, sessions, "2026-11-14").missed).toEqual(["upperA", "lowerA", "upperB", "lowerB"]);
    });
});

describe("grid (R26)", () => {
    it("shows the current week alone when nothing is logged", () => {
        const rows = summary.grid(plan, [], [], "2026-11-14");
        expect(rows).toHaveLength(1);
        expect(rows[0].weekStart).toBe("2026-11-09");
        expect(rows[0].workouts.map((w) => w.done)).toEqual([false, false, false, false]);
        expect(rows[0].routine.map((d) => d.date)).toEqual([
            "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
        ]);
        expect(rows[0].routine.every((d) => d.done === false)).toBe(true);
    });

    it("marks a Workout done on the date it was really done, and a Routine day checked", () => {
        const sessions = [session("2026-11-11", "upperA")];
        const checks = [{ date: "2026-11-10" }];
        const [row] = summary.grid(plan, sessions, checks, "2026-11-14");
        expect(row.workouts[0]).toMatchObject({ key: "upperA", done: true, date: "2026-11-11" });
        expect(row.workouts[1]).toMatchObject({ key: "lowerA", done: false, date: null });
        expect(row.routine.map((d) => d.done)).toEqual([false, true, false, false, false, false, false]);
    });

    it("runs from the first week with activity to the current week, newest first", () => {
        const checks = [{ date: "2026-10-28" }];
        const rows = summary.grid(plan, [], checks, "2026-11-14");
        expect(rows.map((r) => r.weekStart)).toEqual(["2026-11-09", "2026-11-02", "2026-10-26"]);
    });

    it("orders the Workout cells by weekday", () => {
        const moved = { ...plan, workouts: [{ ...plan.workouts[0], weekday: 6 }, ...plan.workouts.slice(1)] };
        const [row] = summary.grid(moved, [], [], "2026-11-14");
        expect(row.workouts.map((w) => w.key)).toEqual(["lowerA", "upperB", "lowerB", "upperA"]);
    });
});

describe("weight (R18)", () => {
    const phase = plan.phase;

    it("has no average and no change with no Weigh-in", () => {
        expect(summary.weight([], phase, "2026-11-14")).toEqual({
            latest: null, average: null, count: 0, startLb: 245, targetLb: 216, change: null,
        });
    });

    it("uses the one Weigh-in as the average", () => {
        const w = summary.weight([{ date: "2026-11-14", lb: 241.5 }], phase, "2026-11-14");
        expect(w).toMatchObject({ latest: { date: "2026-11-14", lb: 241.5 }, average: 241.5, count: 1, change: -3.5 });
    });

    it("averages the Weigh-ins of the last 7 days, today included", () => {
        // 244 + 243 + 243 + 242 + 242 + 241 + 240 = 1695; 1695 / 7 = 242.142… → 242.1
        const lbs = [244, 243, 243, 242, 242, 241, 240];
        const weighins = lbs.map((lb, i) => ({ date: addDays("2026-11-08", i), lb }));
        const w = summary.weight(weighins, phase, "2026-11-14");
        expect(w).toMatchObject({ average: 242.1, count: 7, change: -2.9, latest: { date: "2026-11-14", lb: 240 } });
    });

    it("leaves out a Weigh-in older than 7 days", () => {
        const weighins = [{ date: "2026-11-07", lb: 250 }, { date: "2026-11-08", lb: 244 }, { date: "2026-11-14", lb: 240 }];
        expect(summary.weight(weighins, phase, "2026-11-14")).toMatchObject({ average: 242, count: 2 });
    });

    it("keeps the latest Weigh-in when it is outside the window", () => {
        const w = summary.weight([{ date: "2026-11-01", lb: 244 }], phase, "2026-11-14");
        expect(w).toMatchObject({ latest: { date: "2026-11-01", lb: 244 }, average: null, count: 0, change: null });
    });
});

describe("bests (R28) and previous (R22)", () => {
    const movements = [
        { _id: "pull", name: "Pull-up", kind: "reps" },
        { _id: "hold", name: "Handstand hold", kind: "hold" },
        { _id: "none", name: "Never done", kind: "reps" },
    ];
    const sessions = [
        session("2026-11-09", "upperA", [
            { id: "a", movementId: "pull", full: 8, partial: 2, assisted: 1 },
            { id: "b", movementId: "pull", full: 6, partial: 3, assisted: 2 },
            { id: "c", movementId: "hold", seconds: 20 },
        ]),
        session("2026-11-12", "upperB", [
            { id: "d", movementId: "pull", full: 9, partial: 1, assisted: 0 },
            { id: "e", movementId: "hold", seconds: 25 },
            { id: "f", movementId: "hold", seconds: 18 },
        ]),
    ];

    it("takes the best full reps of each Session for a reps Movement", () => {
        const b = summary.bests(movements, sessions);
        expect(b.pull.series).toEqual([
            { date: "2026-11-09", value: 8 },
            { date: "2026-11-12", value: 9 },
        ]);
        expect(b.pull.best).toEqual({ date: "2026-11-12", value: 9 });
    });

    it("takes the longest hold of each Session for a hold Movement", () => {
        const b = summary.bests(movements, sessions);
        expect(b.hold.series.map((p) => p.value)).toEqual([20, 25]);
        expect(b.hold.best).toEqual({ date: "2026-11-12", value: 25 });
    });

    it("gives a Movement with no Set an empty series", () => {
        expect(summary.bests(movements, sessions).none).toEqual({ best: null, series: [] });
    });

    it("returns the Sets of the last Session before today", () => {
        const p = summary.previous(sessions, "2026-11-12");
        expect(p.pull).toEqual({ date: "2026-11-09", sets: [sessions[0].sets[0], sessions[0].sets[1]] });
        expect(summary.previous(sessions, "2026-11-13").pull.date).toBe("2026-11-12");
    });

    it("has no previous Sets for a Movement first done today", () => {
        expect(summary.previous(sessions, "2026-11-09").pull).toBeUndefined();
    });
});
