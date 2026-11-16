// Body — the Mongo repository. The I/O half, untested by the repo's convention
// (see the note atop lib/providers/providers.test.js); the rules it serves are
// covered by service.test.js against an in-memory twin.
//
// One collection for each kind of record (spec R1). The Plan is a single
// document; Routine checks and Weigh-ins are found by their date, which is
// what makes "one for each date" hold.

const { ObjectId } = require("mongodb");
const { getDB } = require("../../config/db");

const COLLECTIONS = {
    plan: "Body Plan",
    movements: "Body Movements",
    sessions: "Body Sessions",
    checks: "Body Routine Checks",
    weighins: "Body Weigh-ins",
};

const col = (kind) => getDB().collection(COLLECTIONS[kind]);

// A malformed id matches nothing rather than throwing, so it surfaces as the
// same not-found a deleted record would.
function oid(id) {
    return ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : null;
}

const withStringId = (doc) => (doc ? { ...doc, _id: String(doc._id) } : null);

async function getPlan() {
    const doc = await col("plan").findOne({});
    if (!doc) return null;
    const { _id, ...plan } = doc;
    return plan;
}

async function setPlan(plan) {
    await col("plan").replaceOne({}, { ...plan }, { upsert: true });
}

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

// One atomic push, so two Sets saved close together both land. A read, change
// and write of the whole list would let the second write drop the first Set.
async function pushSet(id, set) {
    const _id = oid(id);
    if (!_id) return false;
    return (await col("sessions").updateOne({ _id }, { $push: { sets: set } })).matchedCount > 0;
}

async function putByDate(kind, date, fields) {
    await col(kind).updateOne({ date }, { $set: { date, ...fields } }, { upsert: true });
}

async function removeByDate(kind, date) {
    return (await col(kind).deleteMany({ date })).deletedCount > 0;
}

module.exports = { getPlan, setPlan, list, get, insert, update, remove, pushSet, putByDate, removeByDate, COLLECTIONS };
