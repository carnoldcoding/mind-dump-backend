// Finances — HTTP controllers (spec R42). Thin, like Mind's: each calls the
// service with the Mongo repository and maps a refused write to a status code.
// Gating is at nginx (tailnet), same as the other System routes (ADR-0001).
//
// The client sends its own date as `today` wherever one matters; the server
// runs in UTC — see lib/finances/service.js.

const repo = require("../lib/finances/repository");
const service = require("../lib/finances/service");
const { FinanceError } = require("../lib/finances/errors");

const STATUS_FOR = {
    invalid_input: 400,
    not_found: 404,
    over_unassigned: 409,
    starting_balance_exists: 409,
    envelope_not_empty: 409,
    envelope_scheduled: 409,
};

function handleError(res, err, where) {
    if (err instanceof FinanceError) {
        return res.status(STATUS_FOR[err.code] || 400).json({ error: err.code, message: err.message });
    }
    console.error(`Error in finances ${where}:`, err);
    return res.status(500).json({ message: "Server error" });
}

// Wraps a service call as a route handler; `run` gets the request body.
const handler = (where, status, run) => async (req, res) => {
    try {
        const result = await run(req.body || {}, req);
        res.status(status).json(result ?? { ok: true });
    } catch (err) { handleError(res, err, where); }
};

// GET /api/finances?today=YYYY-MM-DD — records due Scheduled transactions,
// then returns every record plus the computed balances (R26).
const getAll = handler("getAll", 200, (_, req) => service.load(repo, req.query.today));

const addTransaction = handler("addTransaction", 201, (b) => service.addTransaction(repo, b));
const updateTransaction = handler("updateTransaction", 200, ({ id, ...b }) => service.updateTransaction(repo, id, b));
const removeTransaction = handler("removeTransaction", 200, ({ id }) => service.removeTransaction(repo, id));

const addAssignment = handler("addAssignment", 201, (b) => service.addAssignment(repo, b));
const updateAssignment = handler("updateAssignment", 200, ({ id, ...b }) => service.updateAssignment(repo, id, b));
const removeAssignment = handler("removeAssignment", 200, ({ id }) => service.removeAssignment(repo, id));
const fundTargets = handler("fundTargets", 200, ({ today }) => service.fundTargets(repo, today));

const addEnvelope = handler("addEnvelope", 201, (b) => service.addEnvelope(repo, b));
const updateEnvelope = handler("updateEnvelope", 200, ({ id, ...b }) => service.updateEnvelope(repo, id, b));
const reorderEnvelopes = handler("reorderEnvelopes", 200, ({ ids }) => service.reorderEnvelopes(repo, ids));

const addSchedule = handler("addSchedule", 201, ({ today, ...b }) => service.addSchedule(repo, b, today));
const updateSchedule = handler("updateSchedule", 200, ({ id, ...b }) => service.updateSchedule(repo, id, b));
const removeSchedule = handler("removeSchedule", 200, ({ id }) => service.removeSchedule(repo, id));

module.exports = {
    getAll,
    addTransaction, updateTransaction, removeTransaction,
    addAssignment, updateAssignment, removeAssignment, fundTargets,
    addEnvelope, updateEnvelope, reorderEnvelopes,
    addSchedule, updateSchedule, removeSchedule,
};
