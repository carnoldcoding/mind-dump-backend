const express = require('express');
const router = express.Router();

// nginx allow/deny (tailnet-only) fronts this route, like the other System
// surfaces — if a request reaches here, the caller is already trusted
// (ADR-0001). Writes are POSTs with the id in the body, the same shape as Body.
const c = require('../../controllers/finances');

router.get('/', c.getAll);

router.post('/transactions/add', c.addTransaction);
router.post('/transactions/update', c.updateTransaction);
router.post('/transactions/remove', c.removeTransaction);

router.post('/assignments/add', c.addAssignment);
router.post('/assignments/update', c.updateAssignment);
router.post('/assignments/remove', c.removeAssignment);
router.post('/assignments/fund_targets', c.fundTargets);

router.post('/envelopes/add', c.addEnvelope);
router.post('/envelopes/update', c.updateEnvelope);
router.post('/envelopes/reorder', c.reorderEnvelopes);

router.post('/schedules/add', c.addSchedule);
router.post('/schedules/update', c.updateSchedule);
router.post('/schedules/remove', c.removeSchedule);

module.exports = router;
