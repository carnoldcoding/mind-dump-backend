const mediaStore = require('../lib/mediaStore');

async function uploadAudio(req, res) {
  try {
    const { post_id, title } = req.body;
    const file = req.file;

    if (!file || !title) {
      return res.status(400).json({ message: 'file and title are required' });
    }

    const doc = await mediaStore.upload('audio', file, { title, post_id: post_id || null });
    res.status(201).json({ message: 'Audio uploaded', ...doc });
  } catch (error) {
    console.error('Upload audio error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getAudio(req, res) {
  try {
    const { post_id } = req.query;
    const filter = post_id ? { post_id } : {};
    const tracks = await mediaStore.list('audio', filter);
    res.status(200).json(tracks);
  } catch (error) {
    console.error('Get audio error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function deleteAudio(req, res) {
  try {
    const { id } = req.params;
    const track = await mediaStore.remove('audio', id);
    if (!track) return res.status(404).json({ message: 'Track not found' });
    res.status(200).json({ message: 'Audio deleted', deletedCount: 1 });
  } catch (error) {
    console.error('Delete audio error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { uploadAudio, getAudio, deleteAudio };
