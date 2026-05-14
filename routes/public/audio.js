const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadAudio, getAudio, deleteAudio } = require('../../controllers/audio');
const { requireAuth } = require('../../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', requireAuth, upload.single('file'), uploadAudio);
router.get('/', getAudio);
router.delete('/:id', requireAuth, deleteAudio);

module.exports = router;
