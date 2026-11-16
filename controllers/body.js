// Body — HTTP controllers. Thin, like Finances': each calls the service with
// the Mongo repository and maps a refused write to a status code. Gating is at
// nginx (tailnet), same as the other System routes (ADR-0001).
//
// The client sends its own date as `today`; the server runs in UTC — see
// lib/body/service.js.

const repo = require("../lib/body/repository");
const service = require("../lib/body/service");
const { BodyError } = require("../lib/body/errors");

const STATUS_FOR = {
    invalid_input: 400,
    not_found: 404,
    weekday_taken: 409,
    movement_in_plan: 409,
    movement_has_sets: 409,
    plan_exists: 409,
};

function handleError(res, err, where) {
    if (err instanceof BodyError) {
        return res.status(STATUS_FOR[err.code] || 400).json({ error: err.code, message: err.message });
    }
    console.error(`Error in body ${where}:`, err);
    return res.status(500).json({ message: "Server error" });
}

// Wraps a service call as a route handler; `run` gets the request body.
const handler = (where, status, run) => async (req, res) => {
    try {
        const result = await run(req.body || {}, req);
        res.status(status).json(result ?? { ok: true });
    } catch (err) { handleError(res, err, where); }
};

// GET /api/body?today=YYYY-MM-DD — every record plus the computed summary.
const getAll = handler("getAll", 200, (_, req) => service.load(repo, req.query.today));

const addMovement = handler("addMovement", 201, (b) => service.addMovement(repo, b));
const updateMovement = handler("updateMovement", 200, ({ id, ...b }) => service.updateMovement(repo, id, b));
const removeMovement = handler("removeMovement", 200, ({ id }) => service.removeMovement(repo, id));

const updateWorkout = handler("updateWorkout", 200, ({ key, ...b }) => service.updateWorkout(repo, key, b));
const updateRoutine = handler("updateRoutine", 200, (b) => service.updateRoutine(repo, b));
const updatePhase = handler("updatePhase", 200, (b) => service.updatePhase(repo, b));

const startSession = handler("startSession", 200, (b) => service.startSession(repo, b));
const removeSession = handler("removeSession", 200, (b) => service.removeSession(repo, b));
const addSet = handler("addSet", 201, (b) => service.addSet(repo, b));
const updateSet = handler("updateSet", 200, (b) => service.updateSet(repo, b));
const removeSet = handler("removeSet", 200, (b) => service.removeSet(repo, b));
const skipMovement = handler("skipMovement", 200, (b) => service.skipMovement(repo, b));

const checkRoutine = handler("checkRoutine", 200, (b) => service.checkRoutine(repo, b));
const setWeighIn = handler("setWeighIn", 200, (b) => service.setWeighIn(repo, b));
const removeWeighIn = handler("removeWeighIn", 200, (b) => service.removeWeighIn(repo, b));

module.exports = {
    getAll,
    addMovement, updateMovement, removeMovement,
    updateWorkout, updateRoutine, updatePhase,
    startSession, removeSession, addSet, updateSet, removeSet, skipMovement,
    checkRoutine, setWeighIn, removeWeighIn,
};
