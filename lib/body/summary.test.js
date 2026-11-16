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
        expect(summary.weight([], phase, "2026-11-14")).toMatchObject({
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
            { id: "a", movementId: "pull", full: 8 },
            { id: "b", movementId: "pull", full: 6 },
            { id: "c", movementId: "hold", seconds: 20 },
        ]),
        session("2026-11-12", "upperB", [
            { id: "d", movementId: "pull", full: 9 },
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
        expect(summary.bests(movements, sessions).none).toMatchObject({ best: null, series: [] });
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

// Body panes: the numbers of the Progress view. Each expected value is worked
// out by hand.
describe("bests: the points of each Session (panes R39, R40)", () => {
    const m = [{ _id: "m1", kind: "reps" }, { _id: "w1", kind: "reps", loaded: true }];
    const reps = (...values) => values.map((full, i) => ({ id: `r${i}`, movementId: "m1", full }));
    const three = [
        session("2026-11-09", "upperA", reps(5, 4)),
        session("2026-11-12", "upperB", reps(5, 5)),
        session("2026-11-16", "upperA", reps(7, 3)),
    ];

    it("gives the best Set, the first Set and the sum of each Session", () => {
        const b = summary.bests(m, three).m1;
        expect(b.series.map((p) => p.value)).toEqual([5, 5, 7]);
        expect(b.first.map((p) => p.value)).toEqual([5, 5, 7]);
        expect(b.total).toEqual([
            { date: "2026-11-09", value: 9 },
            { date: "2026-11-12", value: 10 },
            { date: "2026-11-16", value: 10 },
        ]);
        expect(b).toMatchObject({ sessions: 3, sets: 6, sum: 29, best: { date: "2026-11-16", value: 7 } });
    });

    it("takes the first Set as logged, not the best one", () => {
        const b = summary.bests(m, [session("2026-11-09", "upperA", reps(4, 6))]).m1;
        expect(b.first).toEqual([{ date: "2026-11-09", value: 4 }]);
        expect(b.series).toEqual([{ date: "2026-11-09", value: 6 }]);
    });

    it("calls a Session a record only when it beats each earlier Session", () => {
        // 5 is the first Session, 5 again is equal, 7 is higher.
        expect(summary.bests(m, three).m1.records).toEqual(["2026-11-16"]);
        expect(summary.bests(m, three.slice(0, 1)).m1.records).toEqual([]);
        expect(summary.bests(m, three.slice(0, 2)).m1.records).toEqual([]);
    });

    it("compares the last Session with the one before it", () => {
        expect(summary.bests(m, three.slice(0, 1)).m1.trend).toBeNull();
        expect(summary.bests(m, three.slice(0, 2)).m1.trend).toBe("same");
        expect(summary.bests(m, three).m1.trend).toBe("up");
        expect(summary.bests(m, [...three, session("2026-11-19", "upperB", reps(6))]).m1.trend).toBe("down");
    });

    it("gives the highest load of each Session that has one", () => {
        const sessions = [
            session("2026-11-09", "upperA", [{ id: "a", movementId: "w1", full: 8, load: 25 }, { id: "b", movementId: "w1", full: 6, load: 35 }]),
            session("2026-11-12", "upperB", [{ id: "c", movementId: "w1", full: 8 }]),
        ];
        expect(summary.bests(m, sessions).w1.load).toEqual([{ date: "2026-11-09", value: 35 }]);
    });

    it("gives a Movement with no Set zero counts and no trend", () => {
        expect(summary.bests(m, []).m1).toEqual({ best: null, series: [], first: [], total: [], load: [], sessions: 0, sets: 0, sum: 0, trend: null, records: [] });
    });

    it("lists the records of all Movements, newest first, 10 at most", () => {
        const byMovement = summary.bests(m, [
            ...three,
            session("2026-11-10", "lowerA", [{ id: "x", movementId: "w1", full: 3 }]),
            session("2026-11-17", "lowerA", [{ id: "y", movementId: "w1", full: 4 }]),
        ]);
        expect(summary.records(byMovement)).toEqual([
            { movementId: "w1", date: "2026-11-17", value: 4 },
            { movementId: "m1", date: "2026-11-16", value: 7 },
        ]);

        const many = Array.from({ length: 13 }, (_, i) => session(addDays("2026-08-03", i * 7), "upperA", reps(i + 1)));
        const list = summary.records(summary.bests(m, many));
        expect(list).toHaveLength(10);
        expect(list[0]).toEqual({ movementId: "m1", date: "2026-10-26", value: 13 });
    });
});

describe("weight: the pace and the projected date (panes R41–R44)", () => {
    const phase = { startLb: 245, targetLb: 216 };
    const weekly = (...lbs) => lbs.map((lb, i) => ({ date: addDays("2026-11-01", i * 7), lb }));

    it("gives the slope of the last 28 days in pounds for each week", () => {
        // 240, 239, 238, 237 one week apart: one pound down each week.
        const w = summary.weight(weekly(240, 239, 238, 237), phase, "2026-11-22");
        expect(w.pace).toBe(-1);
        // The average of the last 7 days is the one Weigh-in of 11-22.
        expect(w.average).toBe(237);
        expect(w.toGo).toBe(21);
        // 21 lb at 1 lb a week is 147 days after 2026-11-22.
        expect(w.eta).toBe("2027-04-18");
    });

    it("has no pace with fewer than 4 Weigh-ins, or with all of them inside one week", () => {
        expect(summary.weight(weekly(240, 239, 238), phase, "2026-11-15").pace).toBeNull();
        const close = [240, 239, 238, 237].map((lb, i) => ({ date: addDays("2026-11-16", i * 2), lb }));
        expect(summary.weight(close, phase, "2026-11-22").pace).toBeNull();
        expect(summary.weight(close, phase, "2026-11-22").eta).toBeNull();
    });

    it("leaves a Weigh-in older than 28 days out of the pace", () => {
        // 2026-10-25 is 28 days before 11-22: outside. Three are left.
        const w = summary.weight([{ date: "2026-10-25", lb: 250 }, ...weekly(240, 239, 238).map((x) => ({ ...x, date: addDays(x.date, 7) }))], phase, "2026-11-22");
        expect(w.pace).toBeNull();
    });

    it("has no projected date when the weight moves away from the target, or does not move", () => {
        expect(summary.weight(weekly(237, 238, 239, 240), phase, "2026-11-22")).toMatchObject({ pace: 1, eta: null });
        expect(summary.weight(weekly(240, 240, 240, 240), phase, "2026-11-22")).toMatchObject({ pace: 0, eta: null });
    });

    it("gives the lowest Weigh-in of all, and nothing with no Weigh-in", () => {
        expect(summary.weight(weekly(240, 236, 238), phase, "2026-11-15").lowest).toEqual({ date: "2026-11-08", lb: 236 });
        expect(summary.weight([], phase, "2026-11-15")).toMatchObject({ lowest: null, toGo: null, pace: null, eta: null });
    });
});

describe("adherence and totals (panes R45–R47)", () => {
    // Wednesday 2026-11-18. Last week: three of four Workouts. This week: Monday's.
    const sessions = [
        session("2026-11-09", "upperA"),
        session("2026-11-10", "lowerA"),
        session("2026-11-12", "upperB"),
        session("2026-11-16", "upperA"),
    ];
    const checks = [{ date: "2026-11-09" }, { date: "2026-11-10" }, { date: "2026-11-17" }];
    const at = (s, c, date) => summary.adherence(summary.grid(plan, s, c, date), c, date);

    it("counts a Workout of the current week as planned once its weekday has come", () => {
        // Last week 4 planned, 3 done. This week Monday and Tuesday planned, Monday done.
        expect(at(sessions, checks, "2026-11-18").workouts).toEqual({ done: 4, planned: 6 });
    });

    it("counts each Workout over all weeks", () => {
        expect(at(sessions, checks, "2026-11-18").byWorkout).toEqual({
            upperA: { done: 2, planned: 2 },
            lowerA: { done: 1, planned: 2 },
            upperB: { done: 1, planned: 1 },
            lowerB: { done: 0, planned: 1 },
        });
    });

    it("counts the days of Stretches from the first record, 28 days at most", () => {
        // 2026-11-09 to 2026-11-18 is 10 days; 3 are checked.
        expect(at(sessions, checks, "2026-11-18").stretches).toEqual({ done: 3, days: 10 });
        // A first record 6 weeks back: the last 28 days count, and the old check does not.
        const old = [{ date: "2026-10-05" }, ...checks];
        expect(at(sessions, old, "2026-11-18").stretches).toEqual({ done: 3, days: 28 });
    });

    it("limits the Workout count to the 4 newest weeks", () => {
        // A Session 6 weeks back makes 7 weeks. The 4 newest: 4 + 4 + 4 + 2 planned.
        const long = [session("2026-10-05", "upperA"), ...sessions];
        const a = at(long, checks, "2026-11-18");
        expect(a.workouts).toEqual({ done: 4, planned: 14 });
        // All 7 weeks: Upper A is planned 7 times and done 3 times.
        expect(a.byWorkout.upperA).toEqual({ done: 3, planned: 7 });
    });

    it("plans nothing before the first record", () => {
        expect(at([], [], "2026-11-15")).toEqual({
            workouts: { done: 0, planned: 4 },
            stretches: { done: 0, days: 0 },
            byWorkout: { upperA: { done: 0, planned: 1 }, lowerA: { done: 0, planned: 1 }, upperB: { done: 0, planned: 1 }, lowerB: { done: 0, planned: 1 } },
        });
    });

    it("counts the Sessions that hold a Set, and their Sets", () => {
        const two = session("2026-11-17", "lowerA", [{ id: "a", movementId: "m1", full: 5 }, { id: "b", movementId: "m1", full: 4 }]);
        expect(summary.totals([...sessions, two, session("2026-11-18", "upperB", [])])).toEqual({ sessions: 5, sets: 6 });
    });

    it("puts the new numbers in the summary", () => {
        const out = summary.summarize({ plan, movements: [{ _id: "m1", kind: "reps" }], sessions, checks, weighins: [] }, "2026-11-18");
        expect(out.adherence.workouts).toEqual({ done: 4, planned: 6 });
        expect(out.totals).toEqual({ sessions: 4, sets: 4 });
        expect(out.records).toEqual([]);
    });
});
