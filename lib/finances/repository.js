// Finances — the Mongo repository. The I/O half, untested by the repo's
// convention (see the note atop lib/providers/providers.test.js); the rules it
// serves are covered by service.test.js against an in-memory twin.
//
// Documents keep Mongo ObjectIds as their own _id, and refer to each other
// (envelopeId, sourceEnvelopeId, scheduleId) by the id's string form, which is
// what the frontend sends back.

const { ObjectId } = require("mongodb");
const { getDB } = require("../../config/db");

const COLLECTIONS = {
    envelopes: "Finance Envelopes",
    transactions: "Finance Transactions",
    assignments: "Finance Assignments",
    schedules: "Finance Schedules",
};

const col = (kind) => getDB().collection(COLLECTIONS[kind]);

// A malformed id matches nothing rather than throwing, so it surfaces as the
// same not-found a deleted record would.
function oid(id) {
    return ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : null;
}

const withStringId = (doc) => (doc ? { ...doc, _id: String(doc._id) } : null);

async function list(kind) {
    return (await col(kind).find({}).toArray()).map(withStringId);
}

async function get(kind, id) {
    const _id = oid(id);
    return _id ? withStringId(await col(kind).findOne({ _id })) : null;
}

async function insert(kind, doc) {
    const { insertedId } = await col(kind).insertOne({ ...doc });
    return { ...doc, _id: String(insertedId) };
}

async function insertMany(kind, docs) {
    if (docs.length > 0) await col(kind).insertMany(docs.map((d) => ({ ...d })));
}

async function update(kind, id, fields) {
    const _id = oid(id);
    if (!_id) return false;
    return (await col(kind).updateOne({ _id }, { $set: fields })).matchedCount > 0;
}

async function remove(kind, id) {
    const _id = oid(id);
    if (!_id) return false;
    return (await col(kind).deleteOne({ _id })).deletedCount > 0;
}

// Move a schedule's lastRecorded forward only if it still holds the value the
// caller read. One atomic update, so of two racing loads exactly one wins.
async function claimSchedule(id, expected, last) {
    const _id = oid(id);
    if (!_id) return false;
    const r = await col("schedules").updateOne({ _id, lastRecorded: expected }, { $set: { lastRecorded: last } });
    return r.modifiedCount > 0;
}

module.exports = { list, get, insert, insertMany, update, remove, claimSchedule, COLLECTIONS };
