const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

async function getAllEntries(req, res) {
  try {
    const db = getDB();
    const { workoutName } = req.query;
    let filter = {};

    if (workoutName) filter.workoutName = workoutName;

    const entries = await db.collection('Body Data').find(filter).sort({ datetime: -1 }).toArray();
    res.status(200).json(entries);
  } catch (error) {
    console.error('Error fetching body entries:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function addEntry(req, res) {
  try {
    const db = getDB();
    const newEntry = req.body;

    newEntry.createdAt = new Date();

    const result = await db.collection('Body Data').insertOne(newEntry);

    res.status(201).json({
      message: 'Workout entry created successfully',
      id: result.insertedId,
      entry: newEntry
    });
  } catch (error) {
    console.error('Error creating body entry:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function updateEntry(req, res) {
  try {
    const db = getDB();
    const { id, ...updateData } = req.body;

    if (!id) {
      return res.status(400).json({ message: 'id is required' });
    }

    updateData.updatedAt = new Date();

    const result = await db.collection('Body Data').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    res.status(200).json({
      message: 'Workout entry updated successfully',
      id,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error updating body entry:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function removeEntry(req, res) {
  try {
    const db = getDB();
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ message: 'id is required' });
    }

    const result = await db.collection('Body Data').deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    res.status(200).json({
      message: 'Workout entry deleted successfully',
      id,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting body entry:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { getAllEntries, addEntry, updateEntry, removeEntry };
