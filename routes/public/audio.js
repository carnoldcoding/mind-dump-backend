const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadAudio, getAudio, deleteAudio } = require('../../controllers/audio');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// nginx allow/deny (tailnet-only) fronts upload/delete; only GET is public.
router.post('/upload', upload.single('file'), uploadAudio);
router.get('/', getAudio);
router.delete('/:id', deleteAudio);

module.exports = router;
