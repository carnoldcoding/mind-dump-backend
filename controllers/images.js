const mediaStore = require('../lib/mediaStore');

async function uploadImage(req, res) {
  try {
    const { post_id, title, type } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'file is required' });
    }

    const doc = await mediaStore.upload('image', file, {
      title: title || null,
      type: type || null,
      post_id: post_id || null,
    });
    res.status(201).json({ message: 'Image uploaded', ...doc });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getImages(req, res) {
  try {
    const { post_id, type } = req.query;
    const filter = {};
    if (post_id) filter.post_id = post_id;
    if (type) filter.type = type;
    const images = await mediaStore.list('image', filter);
    res.status(200).json(images);
  } catch (error) {
    console.error('Get images error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function deleteImage(req, res) {
  try {
    const { id } = req.params;
    const image = await mediaStore.remove('image', id);
    if (!image) return res.status(404).json({ message: 'Image not found' });
    res.status(200).json({ message: 'Image deleted', deletedCount: 1 });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { uploadImage, getImages, deleteImage };
