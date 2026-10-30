// Finances — the operations behind /api/finances (spec R2–R28). Each takes a
// repository (repository.js in production, an in-memory one in the tests), so
// the rules that refuse a write are tested without Mongo.
//
// "today" is always the client's date. The server runs in UTC; near midnight
// its date is not the user's, and a payday recorded on the wrong side of it is
// a wrong month on the Report tab.

const budget = require("./budget");
const { dueDates, dayBefore } = require("./schedule");
const { isIsoDate } = require("./dates");
const { FinanceError, invalid, notFound } = require("./errors");

const KINDS = ["spending", "income"];
const TARGET_KINDS = ["fillTo", "addMonthly"];
const key = (id) => (id == null ? null : String(id));

// ── Input checks ──────────────────────────────────────────────────

function checkDate(date, field = "date") {
    if (!isIsoDate(date)) throw invalid(`${field} must be a YYYY-MM-DD calendar date`);
    return date;
}

// Integer cents, above zero (R1). A refund or a correction is an edit, not a
// negative amount.
function checkAmount(amount) {
    if (!Number.isInteger(amount) || amount <= 0) throw invalid("amount must be a positive whole number of cents");
    return amount;
}

function text(value, max) {
    if (value == null) return "";
    if (typeof value !== "string") throw invalid("text fields must be strings");
    const t = value.trim();
    if (t.length > max) throw invalid(`text is longer than ${max} characters`);
    return t;
}

function checkTarget(target) {
    if (target == null) return null;
    if (!TARGET_KINDS.includes(target.kind)) throw invalid(`target kind must be one of ${TARGET_KINDS.join(", ")}`);
    return { kind: target.kind, amount: checkAmount(target.amount) };
}

async function existingEnvelope(repo, id) {
    const e = id == null ? null : await repo.get("envelopes", id);
    if (!e) throw notFound("Envelope");
    return e;
}

// The shape a Transaction or Scheduled transaction shares (R2, R6): spending
// names exactly one Envelope, income names none — it lands in Unassigned.
async function moneyFields(repo, input) {
    if (!KINDS.includes(input.kind)) throw invalid(`kind must be one of ${KINDS.join(", ")}`);
    const fields = {
        amount: checkAmount(input.amount),
        kind: input.kind,
        envelopeId: null,
        payee: text(input.payee, 120),
        note: text(input.note, 500),
    };
    if (input.kind === "spending") {
        if (input.envelopeId == null) throw invalid("spending needs an Envelope");
        fields.envelopeId = key((await existingEnvelope(repo, input.envelopeId))._id);
    } else if (input.envelopeId != null) {
        throw invalid("income has no Envelope; it goes to Unassigned");
    }
    return fields;
}

// ── Reading ───────────────────────────────────────────────────────

// Record every due day of every Scheduled transaction (R26). The claim moves a
// schedule's lastRecorded forward only if nobody else has, so two loads that
// race — React mounts twice in development — record a day once.
async function catchUp(repo, today) {
    for (const s of await repo.list("schedules")) {
        const due = dueDates(s, today);
        if (due.length === 0) continue;
        if (!(await repo.claimSchedule(s._id, s.lastRecorded, due[due.length - 1]))) continue;
        await repo.insertMany("transactions", due.map((date) => ({
            date,
            amount: s.amount,
            kind: s.kind,
            envelopeId: s.envelopeId,
            payee: s.payee,
            note: s.note,
            startingBalance: false,
            scheduleId: key(s._id),
        })));
    }
}

async function load(repo, today) {
    checkDate(today, "today");
    await catchUp(repo, today);

    const [envelopes, transactions, assignments, schedules] = await Promise.all([
        repo.list("envelopes"), repo.list("transactions"), repo.list("assignments"), repo.list("schedules"),
    ]);
    envelopes.sort((a, b) => a.sortOrder - b.sortOrder);
    transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    assignments.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const summary = budget.summarize({ envelopes, transactions, assignments }, today);
    return { today, envelopes, transactions, assignments, schedules, summary };
}

async function allData(repo) {
    const [envelopes, transactions, assignments, schedules] = await Promise.all([
        repo.list("envelopes"), repo.list("transactions"), repo.list("assignments"), repo.list("schedules"),
    ]);
    return { envelopes, transactions, assignments, schedules };
}

// ── Transactions ──────────────────────────────────────────────────

// One starting balance at most (R3), and only on income — it is the money
// already in the bank on day one, which the Report leaves out of income.
async function startingBalanceFlag(repo, input, selfId = null) {
    if (!input.startingBalance) return false;
    if (input.kind !== "income") throw invalid("only income can be the starting balance");
    const others = (await repo.list("transactions")).filter((t) => t.startingBalance && key(t._id) !== key(selfId));
    if (others.length > 0) throw new FinanceError("starting_balance_exists", "a starting balance is already recorded");
    return true;
}

async function addTransaction(repo, input) {
    const fields = await moneyFields(repo, input);
    return repo.insert("transactions", {
        date: checkDate(input.date),
        ...fields,
        startingBalance: await startingBalanceFlag(repo, input),
        scheduleId: null,
        createdAt: new Date(),
    });
}

// A recorded Scheduled transaction is an ordinary one (R24): editing it
// changes this record and leaves the schedule alone.
async function updateTransaction(repo, id, input) {
    const fields = await moneyFields(repo, input);
    const update = {
        date: checkDate(input.date),
        ...fields,
        startingBalance: await startingBalanceFlag(repo, input, id),
        updatedAt: new Date(),
    };
    if (!(await repo.update("transactions", id, update))) throw notFound("Transaction");
    return { _id: key(id), ...update };
}

async function removeTransaction(repo, id) {
    if (!(await repo.remove("transactions", id))) throw notFound("Transaction");
}

// ── Assignments ───────────────────────────────────────────────────

async function assignmentFields(repo, input) {
    const fields = {
        date: checkDate(input.date),
        amount: checkAmount(input.amount),
        envelopeId: key((await existingEnvelope(repo, input.envelopeId))._id),
        sourceEnvelopeId: null,
    };
    if (input.sourceEnvelopeId != null) {
        fields.sourceEnvelopeId = key((await existingEnvelope(repo, input.sourceEnvelopeId))._id);
        if (fields.sourceEnvelopeId === fields.envelopeId) throw invalid("an Envelope cannot move money to itself");
    }
    return fields;
}

// A new Assignment out of Unassigned cannot spend money that is not there
// (R15). A move between Envelopes (R16) does not touch Unassigned, and an edit
// may push it negative (R12) — the window then shows it in the error color.
async function addAssignment(repo, input) {
    const fields = await assignmentFields(repo, input);
    if (fields.sourceEnvelopeId == null) {
        const unassigned = budget.unassignedOf(await allData(repo));
        if (fields.amount > unassigned) {
            throw new FinanceError("over_unassigned", "that is more than Unassigned holds");
        }
    }
    return repo.insert("assignments", { ...fields, createdAt: new Date() });
}

async function updateAssignment(repo, id, input) {
    const update = { ...(await assignmentFields(repo, input)), updatedAt: new Date() };
    if (!(await repo.update("assignments", id, update))) throw notFound("Assignment");
    return { _id: key(id), ...update };
}

async function removeAssignment(repo, id) {
    if (!(await repo.remove("assignments", id))) throw notFound("Assignment");
}

// R14: one Assignment, dated today, for each Envelope the plan funds.
async function fundTargets(repo, today) {
    checkDate(today, "today");
    const plan = budget.fundTargets(await allData(repo), today);
    await repo.insertMany("assignments", plan.map((p) => ({
        date: today, amount: p.amount, envelopeId: p.envelopeId, sourceEnvelopeId: null, createdAt: new Date(),
    })));
    return plan;
}

// ── Envelopes ─────────────────────────────────────────────────────

function checkName(name) {
    const n = text(name, 60);
    if (!n) throw invalid("an Envelope needs a name");
    return n;
}

async function addEnvelope(repo, input) {
    const envelopes = await repo.list("envelopes");
    const sortOrder = envelopes.reduce((max, e) => Math.max(max, e.sortOrder + 1), 0);
    return repo.insert("envelopes", {
        name: checkName(input.name),
        sortOrder,
        target: checkTarget(input.target),
        archived: false,
        createdAt: new Date(),
    });
}

// Rename, set or clear the Target, archive or restore (R18, R19). Only the
// fields sent change. Archiving needs a $0 balance — money cannot leave the
// budget with the Envelope — and no schedule still spending from it.
async function updateEnvelope(repo, id, input) {
    const envelope = await existingEnvelope(repo, id);
    const update = {};
    if ("name" in input) update.name = checkName(input.name);
    if ("target" in input) update.target = checkTarget(input.target);
    if ("archived" in input) {
        update.archived = Boolean(input.archived);
        if (update.archived && !envelope.archived) {
            const data = await allData(repo);
            const balance = budget.balancesOf(data).get(key(id)) || 0;
            if (balance !== 0) {
                throw new FinanceError("envelope_not_empty", "move this Envelope's money out before archiving it");
            }
            if (data.schedules.some((s) => key(s.envelopeId) === key(id))) {
                throw new FinanceError("envelope_scheduled", "a Scheduled transaction still uses this Envelope");
            }
        }
    }
    update.updatedAt = new Date();
    await repo.update("envelopes", id, update);
    return { ...envelope, ...update };
}

// The full order, as a list of ids, first to last.
async function reorderEnvelopes(repo, ids) {
    if (!Array.isArray(ids)) throw invalid("ids must be a list");
    for (const [i, id] of ids.entries()) {
        if (!(await repo.update("envelopes", id, { sortOrder: i }))) throw notFound("Envelope");
    }
}

// ── Scheduled transactions ────────────────────────────────────────

function checkDays(days) {
    if (!Array.isArray(days) || days.length === 0) throw invalid("a schedule needs at least one day of the month");
    if (!days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31)) throw invalid("days of the month run from 1 to 31");
    return [...new Set(days)].sort((a, b) => a - b);
}

// lastRecorded starts the day before creation: today counts, nothing earlier
// does (R28).
async function addSchedule(repo, input, today) {
    checkDate(today, "today");
    return repo.insert("schedules", {
        ...(await moneyFields(repo, input)),
        days: checkDays(input.days),
        lastRecorded: dayBefore(today),
        createdAt: new Date(),
    });
}

// lastRecorded is left alone, so an edit changes future recordings only (R25).
async function updateSchedule(repo, id, input) {
    const update = { ...(await moneyFields(repo, input)), days: checkDays(input.days), updatedAt: new Date() };
    if (!(await repo.update("schedules", id, update))) throw notFound("Scheduled transaction");
    return { _id: key(id), ...update };
}

async function removeSchedule(repo, id) {
    if (!(await repo.remove("schedules", id))) throw notFound("Scheduled transaction");
}

module.exports = {
    load,
    addTransaction, updateTransaction, removeTransaction,
    addAssignment, updateAssignment, removeAssignment, fundTargets,
    addEnvelope, updateEnvelope, reorderEnvelopes,
    addSchedule, updateSchedule, removeSchedule,
};
