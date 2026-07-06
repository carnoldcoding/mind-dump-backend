const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadImage, getImages, deleteImage } = require('../../controllers/images');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// nginx allow/deny (tailnet-only) fronts upload/delete; only GET is public.
router.post('/upload', upload.single('file'), uploadImage);
router.get('/', getImages);
router.delete('/:id', deleteImage);

module.exports = router;
