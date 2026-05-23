const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadImage, getImages, deleteImage } = require('../../controllers/images');
const { requireAuth } = require('../../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

router.post('/upload', requireAuth, upload.single('file'), uploadImage);
router.get('/', getImages);
router.delete('/:id', requireAuth, deleteImage);

module.exports = router;
