// Mind — HTTP controllers (spec §2). Thin: they call the service/broker with
// the Mongo repository and map domain errors to status codes. Gating is at
// nginx (tailnet), same as the other System routes — see routes/public/system.js.
//
// SHELVED until the dev database + API key exist: these paths touch Mongo and
// (for teach) the Anthropic API, so none have been run. The logic they wrap is
// covered by lib/mind/*.test.js.

const repo = require("../lib/mind/repository");
const service = require("../lib/mind/service");
const broker = require("../lib/mind/broker");
const { DomainError } = require("../lib/mind/errors");

// Map a domain error's code to an HTTP status.
const STATUS_FOR = {
    invalid_domain: 400,
    title_required: 400,
    discipline_locked: 409,
    quest_not_found: 404,
    quest_not_mastered: 409,
    quest_prestiged: 409,
    discipline_not_found: 404,
    boss_not_available: 409,
};

function handleError(res, err, where) {
    if (err instanceof DomainError) {
        return res.status(STATUS_FOR[err.code] || 400).json({ error: err.code, message: err.message });
    }
    console.error(`Error in ${where}:`, err);
    return res.status(500).json({ message: "Server error" });
}

// GET /api/mind/graph — nodes + disciplines for the map (both lenses).
async function getGraph(req, res) {
    try {
        const [quests, disciplines] = await Promise.all([repo.allQuests(), repo.allDisciplines()]);
        res.status(200).json({ quests, disciplines });
    } catch (err) { handleError(res, err, "getGraph"); }
}

// GET /api/mind/due — quests whose recall is due now.
async function getDue(req, res) {
    try {
        res.status(200).json(await service.dueRecalls(repo, new Date()));
    } catch (err) { handleError(res, err, "getDue"); }
}

// GET /api/mind/events?since=&until=&quest= — the event log for pattern charts.
async function getEvents(req, res) {
    try {
        res.status(200).json(await repo.events(req.query));
    } catch (err) { handleError(res, err, "getEvents"); }
}

// POST /api/mind/sessions — start a teaching session.
async function createSession(req, res) {
    try {
        res.status(201).json(await repo.createSession(req.body || {}));
    } catch (err) { handleError(res, err, "createSession"); }
}

// GET /api/mind/sessions/:id — fetch a session (resume / history).
async function getSession(req, res) {
    try {
        const s = await repo.getSession(req.params.id);
        if (!s) return res.status(404).json({ message: "session not found" });
        res.status(200).json(s);
    } catch (err) { handleError(res, err, "getSession"); }
}

// POST /api/mind/sessions/:id/messages — one teaching turn (the broker).
async function postMessage(req, res) {
    try {
        const { userMessage } = req.body || {};
        if (!userMessage) return res.status(400).json({ message: "userMessage is required" });
        res.status(200).json(await broker.teach(repo, { sessionId: req.params.id, userMessage }));
    } catch (err) { handleError(res, err, "postMessage"); }
}

// POST /api/mind/sessions/:id/end — close a session.
async function endSession(req, res) {
    try {
        await repo.endSession(req.params.id, (req.body || {}).summary || null);
        res.status(204).end();
    } catch (err) { handleError(res, err, "endSession"); }
}

module.exports = { getGraph, getDue, getEvents, createSession, getSession, postMessage, endSession };
