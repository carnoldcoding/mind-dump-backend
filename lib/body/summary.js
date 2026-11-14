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
    return {
        latest: latest ? { date: latest.date, lb: latest.lb } : null,
        average,
        count: window.length,
        startLb: phase.startLb,
        targetLb: phase.targetLb,
        change: average == null ? null : oneDecimal(average - phase.startLb),
    };
}

// The value a Set counts for: seconds for a hold, full reps otherwise.
const setValue = (movement, set) => (movement.kind === "hold" ? set.seconds : set.full);

// For each Movement: the best value of each Session over time, and the best
// of all (R28).
function bests(movements, sessions) {
    const sorted = [...sessions].sort(byDate);
    const out = {};
    for (const m of movements) {
        const series = [];
        for (const s of sorted) {
            const values = (s.sets || [])
                .filter((set) => set.movementId === m._id)
                .map((set) => setValue(m, set))
                .filter((v) => typeof v === "number");
            if (values.length > 0) series.push({ date: s.date, value: Math.max(...values) });
        }
        let best = null;
        for (const point of series) if (!best || point.value > best.value) best = point;
        out[m._id] = { best, series };
    }
    return out;
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
    return {
        today: today(plan, sessions, date),
        grid: grid(plan, sessions, checks, date),
        weight: weight(weighins, plan.phase, date),
        bests: bests(movements, sessions),
        previous: previous(sessions, date),
    };
}

module.exports = { today, grid, weight, bests, previous, summarize, doneInWeek };
