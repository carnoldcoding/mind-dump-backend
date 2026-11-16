// Body — the computed summary (spec R5): what is due today, the grid of weeks,
// the bodyweight average, and the best Set of each Movement. Pure functions
// over the stored records, so each rule is tested without Mongo.

const { addDays, weekdayOf, weekStart } = require("./dates");

const hasSets = (session) => Array.isArray(session.sets) && session.sets.length > 0;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const oneDecimal = (n) => Math.round(n * 10) / 10;

// The first Session of a Workout in one week that holds a Set. A Workout counts
// as done for the week when one exists (R25); a Session that was only started
// does not count.
function doneInWeek(sessions, key, start) {
    const end = addDays(start, 6);
    return sessions
        .filter((s) => s.workoutKey === key && hasSets(s) && s.date >= start && s.date <= end)
        .sort(byDate)[0] || null;
}

// What the Today view needs (R13, R15, R16). `missed` holds the Workouts that
// were planned for an earlier weekday of this week and are not done. The list
// uses the current week only, so a miss ends with its week.
function today(plan, sessions, date) {
    const weekday = weekdayOf(date);
    const start = weekStart(date);
    const due = plan.workouts.find((w) => w.weekday === weekday) || null;
    const missed = plan.workouts
        .filter((w) => w.weekday < weekday && !doneInWeek(sessions, w.key, start))
        .sort((a, b) => a.weekday - b.weekday)
        .map((w) => w.key);
    return {
        date,
        weekday,
        due: due ? due.key : null,
        dueDone: due ? Boolean(doneInWeek(sessions, due.key, start)) : false,
        missed,
    };
}

// One row for each week, newest first, from the first week with a Set or a
// Routine check to the current week (R26). No streak count: each cell stands
// alone, so one missed day does not erase the days around it.
function grid(plan, sessions, checks, date) {
    const current = weekStart(date);
    const active = [...sessions.filter(hasSets).map((s) => s.date), ...checks.map((c) => c.date)];
    let first = current;
    for (const d of active) {
        const start = weekStart(d);
        if (start < first) first = start;
    }

    const checked = new Set(checks.map((c) => c.date));
    const workouts = [...plan.workouts].sort((a, b) => a.weekday - b.weekday);
    const rows = [];
    for (let start = current; start >= first; start = addDays(start, -7)) {
        rows.push({
            weekStart: start,
            workouts: workouts.map((w) => {
                const done = doneInWeek(sessions, w.key, start);
                return { key: w.key, name: w.name, weekday: w.weekday, done: Boolean(done), date: done ? done.date : null };
            }),
            routine: Array.from({ length: 7 }, (_, i) => {
                const day = addDays(start, i);
                return { date: day, done: checked.has(day) };
            }),
        });
    }
    return rows;
}

// Bodyweight against the Phase (R18). The average covers the Weigh-ins of the
// last 7 days, today included, however many exist. Progress uses the average
// because one day's value moves with water and food.
function weight(weighins, phase, date) {
    const sorted = [...weighins].sort(byDate);
    const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    const from = addDays(date, -6);
    const window = sorted.filter((w) => w.date >= from && w.date <= date);
    const average = window.length > 0
        ? oneDecimal(window.reduce((sum, w) => sum + w.lb, 0) / window.length)
        : null;
    const rate = pace(sorted, date);
    return {
        latest: latest ? { date: latest.date, lb: latest.lb } : null,
        average,
        count: window.length,
        startLb: phase.startLb,
        targetLb: phase.targetLb,
        change: average == null ? null : oneDecimal(average - phase.startLb),
        lowest: sorted.reduce((low, w) => (!low || w.lb < low.lb ? { date: w.date, lb: w.lb } : low), null),
        toGo: average == null ? null : oneDecimal(average - phase.targetLb),
        pace: rate,
        eta: eta(average, phase.targetLb, rate, date),
    };
}

const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);

// Pounds for each week (panes R42): the least-squares slope of the Weigh-ins of
// the last 28 days. One day's value moves with water and food, so a line
// through four weeks is the trend. Fewer than 4 Weigh-ins, or all of them
// inside one week, is not enough to draw it.
function pace(weighins, date) {
    const from = addDays(date, -27);
    const window = weighins.filter((w) => w.date >= from && w.date <= date).sort(byDate);
    if (window.length < 4) return null;
    const xs = window.map((w) => dayNumber(w.date));
    if (xs[xs.length - 1] - xs[0] < 7) return null;
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = window.reduce((a, w) => a + w.lb, 0) / window.length;
    let over = 0;
    let under = 0;
    window.forEach((w, i) => {
        over += (xs[i] - meanX) * (w.lb - meanY);
        under += (xs[i] - meanX) ** 2;
    });
    return oneDecimal((over / under) * 7);
}

// The date the average reaches the target at the pace (panes R44). Null when
// there is no pace, when it is too small to mean anything, or when it moves
// away from the target.
function eta(average, target, rate, date) {
    if (average == null || rate == null || Math.abs(rate) < 0.1) return null;
    const left = target - average;
    if (left === 0 || Math.sign(left) !== Math.sign(rate)) return null;
    return addDays(date, Math.ceil((left / rate) * 7));
}

// The value a Set counts for: seconds for a hold, full reps otherwise.
const setValue = (movement, set) => (movement.kind === "hold" ? set.seconds : set.full);

// For each Movement, one point for each Session (R28, panes R39): the best
// Set, the first Set, the sum of the Sets, and the highest load. A record is a
// Session whose best is higher than the best of each earlier Session; the
// first Session has nothing to beat, so it is not one (panes R40).
function bests(movements, sessions) {
    const sorted = [...sessions].sort(byDate);
    const out = {};
    for (const m of movements) {
        const series = [];
        const first = [];
        const total = [];
        const load = [];
        const records = [];
        let sets = 0;
        let sum = 0;
        let best = null;
        for (const s of sorted) {
            const own = (s.sets || []).filter((set) => set.movementId === m._id);
            const values = own.map((set) => setValue(m, set)).filter((v) => typeof v === "number");
            if (values.length === 0) continue;
            const top = Math.max(...values);
            const added = values.reduce((a, b) => a + b, 0);
            if (best && top > best.value) records.push(s.date);
            if (!best || top > best.value) best = { date: s.date, value: top };
            series.push({ date: s.date, value: top });
            first.push({ date: s.date, value: values[0] });
            total.push({ date: s.date, value: added });
            const loads = own.map((set) => set.load).filter((v) => typeof v === "number");
            if (loads.length > 0) load.push({ date: s.date, value: Math.max(...loads) });
            sets += values.length;
            sum += added;
        }
        const last = series[series.length - 1];
        const before = series[series.length - 2];
        const trend = !before ? null : last.value > before.value ? "up" : last.value < before.value ? "down" : "same";
        out[m._id] = { best, series, first, total, load, sessions: series.length, sets, sum, trend, records };
    }
    return out;
}

// The last 10 records of all Movements, newest first (panes R48).
function records(byMovement) {
    const all = [];
    for (const [movementId, b] of Object.entries(byMovement)) {
        for (const date of b.records) {
            all.push({ movementId, date, value: b.series.find((p) => p.date === date).value });
        }
    }
    return all.sort((a, b) => byDate(b, a)).slice(0, 10);
}

// Done against planned (panes R45, R46). The grid starts at the week of the
// first record, so nothing before the user began counts as planned. In the
// current week a Workout is planned once its weekday has come. These are
// counts, not a streak: a missed day lowers one number by one and leaves the
// rest alone.
function adherence(rows, checks, date) {
    const current = weekStart(date);
    const weekday = weekdayOf(date);
    const count = (weeks) => {
        const byWorkout = {};
        let done = 0;
        let planned = 0;
        for (const week of weeks) {
            for (const w of week.workouts) {
                const due = w.done || week.weekStart !== current || w.weekday <= weekday;
                const cell = (byWorkout[w.key] ||= { done: 0, planned: 0 });
                if (due) { planned++; cell.planned++; }
                if (w.done) { done++; cell.done++; }
            }
        }
        return { done, planned, byWorkout };
    };

    const recent = count(rows.slice(0, 4));
    const days = rows.flatMap((week) => week.routine).filter((d) => d.date <= date).sort(byDate);
    const firstActive = [...rows].reverse().flatMap((week) => [
        ...week.workouts.filter((w) => w.done).map((w) => w.date),
        ...week.routine.filter((d) => d.done).map((d) => d.date),
    ]).sort()[0];
    const from = addDays(date, -27);
    const window = firstActive ? days.filter((d) => d.date >= firstActive && d.date >= from) : [];
    return {
        workouts: { done: recent.done, planned: recent.planned },
        stretches: { done: window.filter((d) => d.done).length, days: window.length },
        byWorkout: count(rows).byWorkout,
    };
}

function totals(sessions) {
    const withSets = sessions.filter(hasSets);
    return { sessions: withSets.length, sets: withSets.reduce((n, s) => n + s.sets.length, 0) };
}

// For each Movement: the Sets of its last Session before today (R22). Today's
// own Session is left out, so the value beside the fields is the one to beat.
function previous(sessions, date) {
    const out = {};
    const earlier = sessions.filter((s) => s.date < date).sort(byDate);
    for (const s of earlier) {
        const grouped = {};
        for (const set of s.sets || []) (grouped[set.movementId] ||= []).push(set);
        for (const [movementId, sets] of Object.entries(grouped)) out[movementId] = { date: s.date, sets };
    }
    return out;
}

function summarize({ plan, movements, sessions, checks, weighins }, date) {
    const rows = grid(plan, sessions, checks, date);
    const byMovement = bests(movements, sessions);
    return {
        today: today(plan, sessions, date),
        grid: rows,
        weight: weight(weighins, plan.phase, date),
        bests: byMovement,
        previous: previous(sessions, date),
        adherence: adherence(rows, checks, date),
        totals: totals(sessions),
        records: records(byMovement),
    };
}

module.exports = { today, grid, weight, bests, previous, adherence, totals, records, summarize, doneInWeek };
