// Body — the operations behind /api/body (spec R1–R29). Each takes a
// repository (repository.js in production, an in-memory one in the tests), so
// the rules that refuse a write are tested without Mongo.
//
// Every write names the fields it accepts and refuses any other (R3). The old
// controller stored whatever it was sent, which is how a collection came to
// hold two kinds of document told apart by a flag.
//
// "today" is always the client's date. The server runs in UTC; near midnight
// its date is not the user's.

const crypto = require("crypto");
const { summarize } = require("./summary");
const { isIsoDate } = require("./dates");
const { invalid, notFound, conflict } = require("./errors");

const WORKOUT_KEYS = ["upperA", "lowerA", "upperB", "lowerB"];
const KINDS = ["reps", "hold"];
const RULES = ["pastFailure", "failure", "noFailure"];

// ── Input checks ──────────────────────────────────────────────────

function only(input, allowed) {
    if (input == null || typeof input !== "object" || Array.isArray(input)) throw invalid("the request body must be an object");
    for (const field of Object.keys(input)) {
        if (!allowed.includes(field)) throw invalid(`unknown field: ${field}`);
    }
}

function checkDate(date, field = "date") {
    if (!isIsoDate(date)) throw invalid(`${field} must be a YYYY-MM-DD calendar date`);
    return date;
}

function whole(value, field, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw invalid(`${field} must be a whole number from ${min} to ${max}`);
    }
    return value;
}

// Pounds, to one decimal place.
function pounds(value, field, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        throw invalid(`${field} must be a number of pounds from ${min} to ${max}`);
    }
    return Math.round(value * 10) / 10;
}

function name(value, max = 80) {
    if (typeof value !== "string") throw invalid("name must be a string");
    const t = value.trim();
    if (t.length === 0) throw invalid("name is required");
    if (t.length > max) throw invalid(`name is longer than ${max} characters`);
    return t;
}

function oneOf(value, options, field) {
    if (!options.includes(value)) throw invalid(`${field} must be one of ${options.join(", ")}`);
    return value;
}

async function existingPlan(repo) {
    const plan = await repo.getPlan();
    if (!plan) throw notFound("Plan");
    return plan;
}

async function existing(repo, kind, id, what) {
    const doc = id == null ? null : await repo.get(kind, id);
    if (!doc) throw notFound(what);
    return doc;
}

// ── Reading ───────────────────────────────────────────────────────

async function load(repo, today) {
    checkDate(today, "today");
    const [plan, movements, sessions, checks, weighins] = await Promise.all([
        repo.getPlan(), repo.list("movements"), repo.list("sessions"), repo.list("checks"), repo.list("weighins"),
    ]);
    movements.sort((a, b) => a.name.localeCompare(b.name));
    sessions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    weighins.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Before the seed there is no Plan, and nothing to summarise against.
    const summary = plan ? summarize({ plan, movements, sessions, checks, weighins }, today) : null;
    return { today, plan, movements, sessions, checks, weighins, summary };
}

// ── Movements ─────────────────────────────────────────────────────

const MOVEMENT_FIELDS = ["name", "kind", "rule", "sets", "loaded"];

function movementFields(input) {
    const fields = {
        name: name(input.name),
        kind: oneOf(input.kind, KINDS, "kind"),
        rule: oneOf(input.rule, RULES, "rule"),
        sets: whole(input.sets, "sets", 1, 10),
        loaded: input.loaded == null ? false : input.loaded,
    };
    if (typeof fields.loaded !== "boolean") throw invalid("loaded must be true or false");
    // A hold has no partial or assisted reps, so it cannot go past failure.
    if (fields.kind === "hold" && fields.rule === "pastFailure") throw invalid("a hold cannot use the past-failure Rule");
    return fields;
}

async function addMovement(repo, input) {
    only(input, MOVEMENT_FIELDS);
    return repo.insert("movements", movementFields(input));
}

async function updateMovement(repo, id, input) {
    only(input, MOVEMENT_FIELDS);
    const current = await existing(repo, "movements", id, "Movement");
    const fields = movementFields({ ...pick(current, MOVEMENT_FIELDS), ...input });
    await repo.update("movements", id, fields);
    return { ...current, ...fields };
}

// A Movement with Sets is history, and is never deleted (D15). One in the Plan
// has to leave its Workouts first.
async function removeMovement(repo, id) {
    const movement = await existing(repo, "movements", id, "Movement");
    const plan = await repo.getPlan();
    if (plan && plan.workouts.some((w) => w.slots.some((s) => s.movementId === movement._id))) {
        throw conflict("movement_in_plan", "Remove this Movement from its Workouts first");
    }
    const sessions = await repo.list("sessions");
    if (sessions.some((s) => s.sets.some((set) => set.movementId === movement._id))) {
        throw conflict("movement_has_sets", "This Movement has logged Sets and cannot be deleted");
    }
    await repo.remove("movements", id);
    return { ok: true };
}

const pick = (obj, fields) => Object.fromEntries(fields.filter((f) => f in obj).map((f) => [f, obj[f]]));

// ── Plan ──────────────────────────────────────────────────────────

// A slot list is the whole content of a Workout: which Movements, in what
// order, and which neighbours alternate as a Pair. Replacing, adding, removing
// and reordering are all one write of this list (R10).
async function checkSlots(repo, slots) {
    if (!Array.isArray(slots) || slots.length > 30) throw invalid("slots must be a list of at most 30 Movements");
    const known = new Set((await repo.list("movements")).map((m) => m._id));
    const seen = new Set();
    const out = slots.map((slot) => {
        only(slot, ["movementId", "pair"]);
        const movementId = String(slot.movementId);
        if (!known.has(movementId)) throw invalid("a slot names a Movement that does not exist");
        if (seen.has(movementId)) throw invalid("a Movement appears twice in one Workout");
        seen.add(movementId);
        const pair = slot.pair == null ? null : whole(slot.pair, "pair", 1, 30);
        return { movementId, pair };
    });

    // A Pair is exactly two neighbours that share a number.
    const positions = {};
    out.forEach((slot, i) => { if (slot.pair != null) (positions[slot.pair] ||= []).push(i); });
    for (const at of Object.values(positions)) {
        if (at.length !== 2 || at[1] !== at[0] + 1) throw invalid("a Pair is two Movements next to each other");
    }
    return out;
}

async function updateWorkout(repo, key, input) {
    only(input, ["weekday", "slots"]);
    oneOf(key, WORKOUT_KEYS, "key");
    const plan = await existingPlan(repo);
    const workout = plan.workouts.find((w) => w.key === key);
    if (!workout) throw notFound("Workout");

    if (input.weekday !== undefined) {
        const weekday = whole(input.weekday, "weekday", 1, 7);
        if (plan.workouts.some((w) => w.key !== key && w.weekday === weekday)) {
            throw conflict("weekday_taken", "Another Workout is planned for that weekday");
        }
        workout.weekday = weekday;
    }
    if (input.slots !== undefined) workout.slots = await checkSlots(repo, input.slots);

    await repo.setPlan(plan);
    return plan;
}

function routineItem(item) {
    only(item, ["name", "sets", "seconds", "reps"]);
    const out = { name: name(item.name), sets: whole(item.sets, "sets", 1, 10) };
    const timed = item.seconds != null;
    const counted = item.reps != null;
    if (timed === counted) throw invalid("a Routine item has seconds or reps, not both and not neither");
    if (timed) out.seconds = whole(item.seconds, "seconds", 1, 600);
    else out.reps = whole(item.reps, "reps", 1, 100);
    return out;
}

async function updateRoutine(repo, input) {
    only(input, ["items"]);
    if (!Array.isArray(input.items) || input.items.length > 30) throw invalid("items must be a list of at most 30 Routine items");
    const plan = await existingPlan(repo);
    plan.routine = { items: input.items.map(routineItem) };
    await repo.setPlan(plan);
    return plan;
}

async function updatePhase(repo, input) {
    only(input, ["name", "startLb", "targetLb"]);
    const phase = {
        name: name(input.name),
        startLb: pounds(input.startLb, "startLb", 50, 700),
        targetLb: pounds(input.targetLb, "targetLb", 50, 700),
    };
    const plan = await existingPlan(repo);
    plan.phase = phase;
    await repo.setPlan(plan);
    return plan;
}

// ── Sessions and Sets ─────────────────────────────────────────────

// One Session for a Workout on a date. A second start returns the first, so a
// page that mounts twice, or a user who returns later, continues the same one
// (R24).
async function startSession(repo, input) {
    only(input, ["date", "workoutKey"]);
    const date = checkDate(input.date);
    const workoutKey = oneOf(input.workoutKey, WORKOUT_KEYS, "workoutKey");
    await existingPlan(repo);
    const sessions = await repo.list("sessions");
    const current = sessions.find((s) => s.date === date && s.workoutKey === workoutKey);
    if (current) return current;
    return repo.insert("sessions", { date, workoutKey, sets: [], skipped: [] });
}

// What a Set records depends on its Movement: seconds for a hold, full reps
// otherwise. A load, in pounds, only on a loaded Movement.
//
// Partial and assisted reps are not recorded. Past failure the only aim is
// one more rep, and nobody counts there; a number typed in afterward would be
// a guess. The Rule still says how the Set is done. It no longer changes what
// the Set records.
function setValues(movement, input) {
    const values = {};
    if (movement.kind === "hold") {
        if (input.full != null) throw invalid("a hold is logged in seconds, not reps");
        values.seconds = whole(input.seconds, "seconds", 1, 3600);
    } else {
        if (input.seconds != null) throw invalid("this Movement is logged in reps, not seconds");
        values.full = whole(input.full, "full", 1, 1000);
    }
    if (input.load != null) {
        if (!movement.loaded) throw invalid("this Movement takes no load");
        values.load = pounds(input.load, "load", 0.5, 1000);
    }
    return values;
}

const SET_FIELDS = ["full", "seconds", "load"];

async function addSet(repo, input) {
    only(input, ["id", "movementId", ...SET_FIELDS]);
    const session = await existing(repo, "sessions", input.id, "Session");
    const movement = await existing(repo, "movements", input.movementId, "Movement");
    const set = { id: crypto.randomUUID(), movementId: movement._id, ...setValues(movement, input) };

    await repo.pushSet(session._id, set);
    // Logging a Set for a Movement that was skipped un-skips it.
    const skipped = session.skipped.filter((m) => m !== movement._id);
    if (skipped.length !== session.skipped.length) await repo.update("sessions", session._id, { skipped });
    return { ...session, sets: [...session.sets, set], skipped };
}

async function updateSet(repo, input) {
    only(input, ["id", "setId", ...SET_FIELDS]);
    const session = await existing(repo, "sessions", input.id, "Session");
    const index = session.sets.findIndex((s) => s.id === input.setId);
    if (index < 0) throw notFound("Set");
    const movement = await existing(repo, "movements", session.sets[index].movementId, "Movement");
    const sets = [...session.sets];
    sets[index] = { id: sets[index].id, movementId: movement._id, ...setValues(movement, input) };
    await repo.update("sessions", session._id, { sets });
    return { ...session, sets };
}

async function removeSet(repo, input) {
    only(input, ["id", "setId"]);
    const session = await existing(repo, "sessions", input.id, "Session");
    const sets = session.sets.filter((s) => s.id !== input.setId);
    if (sets.length === session.sets.length) throw notFound("Set");
    await repo.update("sessions", session._id, { sets });
    return { ...session, sets };
}

// A skipped Movement is a recorded choice, not a missing Set (R25).
async function skipMovement(repo, input) {
    only(input, ["id", "movementId", "skipped"]);
    if (typeof input.skipped !== "boolean") throw invalid("skipped must be true or false");
    const session = await existing(repo, "sessions", input.id, "Session");
    const movement = await existing(repo, "movements", input.movementId, "Movement");
    const rest = session.skipped.filter((m) => m !== movement._id);
    const skipped = input.skipped ? [...rest, movement._id] : rest;
    await repo.update("sessions", session._id, { skipped });
    return { ...session, skipped };
}

async function removeSession(repo, input) {
    only(input, ["id"]);
    if (!(await repo.remove("sessions", input.id))) throw notFound("Session");
    return { ok: true };
}

// ── Routine and Weigh-in ──────────────────────────────────────────

// One check for a date (R14). Checking twice is the same as checking once.
async function checkRoutine(repo, input) {
    only(input, ["date", "done"]);
    const date = checkDate(input.date);
    if (typeof input.done !== "boolean") throw invalid("done must be true or false");
    if (input.done) await repo.putByDate("checks", date, {});
    else await repo.removeByDate("checks", date);
    return { date, done: input.done };
}

// One Weigh-in for a date; a second entry replaces the first (R17).
async function setWeighIn(repo, input) {
    only(input, ["date", "lb"]);
    const date = checkDate(input.date);
    const lb = pounds(input.lb, "lb", 50, 700);
    await repo.putByDate("weighins", date, { lb });
    return { date, lb };
}

async function removeWeighIn(repo, input) {
    only(input, ["date"]);
    const date = checkDate(input.date);
    if (!(await repo.removeByDate("weighins", date))) throw notFound("Weigh-in");
    return { ok: true };
}

module.exports = {
    load,
    addMovement, updateMovement, removeMovement,
    updateWorkout, updateRoutine, updatePhase,
    startSession, addSet, updateSet, removeSet, skipMovement, removeSession,
    checkRoutine, setWeighIn, removeWeighIn,
    WORKOUT_KEYS, KINDS, RULES,
};
