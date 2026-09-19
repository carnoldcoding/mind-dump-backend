const express = require('express');
const router = express.Router();

// nginx allow/deny (tailnet-only) fronts this route, like the other System
// surfaces — if a request reaches here, the caller is already trusted
// (ADR-0001). The "mind" learning feature is private; there is no public view.
const {
    getGraph, getDue, getEvents,
    createSession, getSession, postMessage, endSession,
} = require('../../controllers/mind');

// Reads for the map / patterns.
router.get('/graph', getGraph);
router.get('/due', getDue);
router.get('/events', getEvents);

// Teaching sessions.
router.post('/sessions', createSession);
router.get('/sessions/:id', getSession);
router.post('/sessions/:id/messages', postMessage);
router.post('/sessions/:id/end', endSession);

module.exports = router;
