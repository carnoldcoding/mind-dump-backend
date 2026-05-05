const express = require('express');
const router = express.Router();

const { getAllEntries, addEntry, updateEntry, removeEntry } = require('../../controllers/soul');

router.get('/', getAllEntries);
router.post('/add_entry', addEntry);
router.post('/update_entry', updateEntry);
router.post('/remove_entry', removeEntry);

module.exports = router;
