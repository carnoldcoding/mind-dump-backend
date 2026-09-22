// Mind — the Mongo repository (spec §4). Materialises a State from the
// projection collections, writes it back, appends events, and stores sessions.
// This is the I/O half: untested by the repo's convention (see the note atop
// lib/providers/providers.test.js). The pure logic it serves is covered by
// lib/mind/*.test.js against an in-memory repo.
//
// Collection names use NieR: Automata OS verbiage (the app's aesthetic) and
// stay clear of "Mind Data", which is the reviews/posts collection:
//   Unit Data      = the Quest nodes        (was "Mind Quests")
//   Archives       = the Disciplines        (was "Mind Disciplines")
//   Log Data       = the event log          (was "Mind Events")
//   Access Records = teaching sessions       (was "Mind Sessions")

const { getDB } = require("../../config/db");
const { State } = require("./state");

const QUESTS = "Unit Data";
const DISCIPLINES = "Archives";
const EVENTS = "Log Data";
const SESSIONS = "Access Records";

// Build a live State from the projection collections. Whole-state load is fine
// at single-user scale (tens of docs); it keeps the domain core storage-agnostic.
async function loadState() {
    const db = getDB();
    const state = new State();
    const [discs, quests] = await Promise.all([
        db.collection(DISCIPLINES).find({}).toArray(),
        db.collection(QUESTS).find({}).toArray(),
    ]);

    for (const d of discs) {
        const domain = state.domains[d.domain];
        if (!domain) continue; // unknown domain slug — skip defensively
        domain.disciplines[d.slug] = {
            slug: d.slug,
            title: d.title || "",
            quests: {},
            logos: d.logos || 0,
            questsSinceBoss: d.questsSinceBoss || 0,
            bloodstain: d.bloodstain ? { amount: d.bloodstain.amount } : null,
        };
    }

    for (const q of quests) {
        const disc = state.domains[q.domain]?.disciplines[q.discipline];
        if (!disc) continue; // orphan quest — skip defensively
        disc.quests[q.slug] = {
            slug: q.slug,
            title: q.title || q.slug,
            streak: q.streak || 0,
            mastered: !!q.mastered,
            masteredAt: q.masteredAt ? new Date(q.masteredAt) : null,
            recallTier: q.mastered ? (q.recallTier ?? 0) : -1,
            nextRecallDue: q.nextRecallDue ? new Date(q.nextRecallDue) : null,
            prestiged: !!q.prestiged,
            // Legacy docs predate `started`; derive a sensible value so a mastered
            // or in-streak Quest counts, and the field persists on the next save.
            started: q.started ?? (!!q.mastered || (q.streak || 0) > 0),
            lore: q.lore ?? null,
            links: q.links || [],
        };
    }

    return state;
}

// Persist the whole State back to the projection collections (upsert by _id).
// Trivial at this scale; a change-tracking optimisation is unnecessary.
async function saveState(state) {
    const db = getDB();
    const questOps = [];
    const discOps = [];

    for (const [domain, d] of Object.entries(state.domains)) {
        for (const [discSlug, disc] of Object.entries(d.disciplines)) {
            const discId = `${domain}/${discSlug}`;
            discOps.push({
                updateOne: {
                    filter: { _id: discId },
                    update: {
                        $set: {
                            domain, slug: discSlug, title: disc.title || "",
                            logos: disc.logos, questsSinceBoss: disc.questsSinceBoss,
                            bloodstain: disc.bloodstain ? { amount: disc.bloodstain.amount } : null,
                            updatedAt: new Date(),
                        },
                    },
                    upsert: true,
                },
            });
            for (const [qSlug, q] of Object.entries(disc.quests)) {
                const qId = `${domain}/${discSlug}/${qSlug}`;
                questOps.push({
                    updateOne: {
                        filter: { _id: qId },
                        update: {
                            $set: {
                                domain, discipline: discSlug, slug: qSlug, title: q.title,
                                streak: q.streak, mastered: q.mastered, masteredAt: q.masteredAt,
                                recallTier: q.recallTier, nextRecallDue: q.nextRecallDue,
                                prestiged: q.prestiged, started: q.started ?? false,
                                lore: q.lore ?? null, links: q.links || [],
                                updatedAt: new Date(),
                            },
                        },
                        upsert: true,
                    },
                });
            }
        }
    }

    if (discOps.length) await db.collection(DISCIPLINES).bulkWrite(discOps);
    if (questOps.length) await db.collection(QUESTS).bulkWrite(questOps);
}

async function appendEvents(events) {
    if (!events || !events.length) return;
    await getDB().collection(EVENTS).insertMany(events);
}

// ── reads for the map / patterns ────────────────────────────────────────────

async function allQuests() {
    return getDB().collection(QUESTS).find({}).toArray();
}
async function allDisciplines() {
    return getDB().collection(DISCIPLINES).find({}).toArray();
}
async function events({ since, until, quest } = {}) {
    const filter = {};
    if (since || until) filter.t = {};
    if (since) filter.t.$gte = new Date(since);
    if (until) filter.t.$lte = new Date(until);
    if (quest) filter.quest = quest;
    return getDB().collection(EVENTS).find(filter).sort({ t: 1 }).toArray();
}

// ── sessions ─────────────────────────────────────────────────────────────────

async function createSession(session) {
    const doc = { startedAt: new Date(), endedAt: null, questsTouched: [], transcript: [], eventIds: [], summary: null, ...session };
    const res = await getDB().collection(SESSIONS).insertOne(doc);
    return { ...doc, _id: res.insertedId };
}
async function getSession(id) {
    const { ObjectId } = require("mongodb");
    return getDB().collection(SESSIONS).findOne({ _id: new ObjectId(id) });
}
async function appendTranscript(id, messages) {
    const { ObjectId } = require("mongodb");
    await getDB().collection(SESSIONS).updateOne(
        { _id: new ObjectId(id) },
        { $push: { transcript: { $each: messages } } }
    );
}
async function endSession(id, summary = null) {
    const { ObjectId } = require("mongodb");
    await getDB().collection(SESSIONS).updateOne(
        { _id: new ObjectId(id) },
        { $set: { endedAt: new Date(), summary } }
    );
}
// The answer key for the MC question the session is currently posing (or null
// when none is outstanding). Deterministic grading reads it in broker.answer;
// it is never sent to the client. See broker.runTurn.
async function setPendingQuestion(id, pending) {
    const { ObjectId } = require("mongodb");
    await getDB().collection(SESSIONS).updateOne(
        { _id: new ObjectId(id) },
        { $set: { pendingQuestion: pending } }
    );
}

module.exports = {
    loadState, saveState, appendEvents,
    allQuests, allDisciplines, events,
    createSession, getSession, appendTranscript, endSession, setPendingQuestion,
    COLLECTIONS: { QUESTS, DISCIPLINES, EVENTS, SESSIONS },
};
