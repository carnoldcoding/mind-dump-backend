const express = require('express');
const router = express.Router();

// nginx allow/deny (tailnet-only) fronts this route, like the other System
// surfaces — if a request reaches here, the caller is already trusted
// (ADR-0001). Writes are POSTs with the id in the body, the same shape as
// Finances.
const c = require('../../controllers/body');

router.get('/', c.getAll);

router.post('/movements/add', c.addMovement);
router.post('/movements/update', c.updateMovement);
router.post('/movements/remove', c.removeMovement);

router.post('/plan/update_workout', c.updateWorkout);
router.post('/plan/update_routine', c.updateRoutine);
router.post('/plan/update_phase', c.updatePhase);

router.post('/sessions/start', c.startSession);
router.post('/sessions/remove', c.removeSession);
router.post('/sessions/add_set', c.addSet);
router.post('/sessions/update_set', c.updateSet);
router.post('/sessions/remove_set', c.removeSet);
router.post('/sessions/skip', c.skipMovement);

router.post('/routine/check', c.checkRoutine);

router.post('/weighins/set', c.setWeighIn);
router.post('/weighins/remove', c.removeWeighIn);

module.exports = router;
