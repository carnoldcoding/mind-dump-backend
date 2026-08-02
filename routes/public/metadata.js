const express = require('express');
const router = express.Router();
const { searchMetadata, metadataDetails, storeCover } = require('../../controllers/metadata');

// Both are tailnet-only at nginx (ADR-0001): they spend quota against
// third-party APIs and write to our own storage, and nothing public needs
// either. Neither is a public read the way GET /api/posts is.
router.get('/search', searchMetadata);
router.get('/details', metadataDetails);
router.post('/cover', storeCover);

module.exports = router;
