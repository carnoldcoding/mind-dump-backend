const express = require('express');
const router = express.Router();

// nginx allow/deny (tailnet-only) fronts this route — if the request reaches
// here at all, the caller is already trusted.
router.get('/probe', (req, res) => res.status(200).json({ trusted: true }));

module.exports = router;
