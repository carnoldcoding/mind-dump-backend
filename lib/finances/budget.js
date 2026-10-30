// Finances — the budget arithmetic (spec R7–R11, R14). Pure: it takes the
// whole set of Envelopes, Transactions and Assignments and returns numbers.
// Whole-set reads are fine at single-user scale, and they keep every balance a
// sum anyone can check by hand — there is no stored balance to drift.
//
// All amounts are integer cents (R1). Ids are compared as strings, because a
// Mongo document carries an ObjectId and a reference to it may be either.

const { monthOf, startOfMonth } = require("./dates");

const key = (id) => (id == null ? null : String(id));

// Unassigned = all income − every Assignment out of Unassigned (R7).
function unassignedOf({ transactions, assignments }) {
    let total = 0;
    for (const t of transactions) if (t.kind === "income") total += t.amount;
    for (const a of assignments) if (key(a.sourceEnvelopeId) == null) total -= a.amount;
    return total;
}

// Each Envelope's balance from the records dated before `before`, or from all
// records when `before` is null. Balances never reset (R8, D7).
function balancesOf({ transactions, assignments }, before = null) {
    const bal = new Map();
    const add = (id, n) => bal.set(id, (bal.get(id) || 0) + n);
    const counts = (date) => before == null || date < before;

    for (const a of assignments) {
        if (!counts(a.date)) continue;
        add(key(a.envelopeId), a.amount);
        if (key(a.sourceEnvelopeId) != null) add(key(a.sourceEnvelopeId), -a.amount);
    }
    for (const t of transactions) {
        if (t.kind === "spending" && counts(t.date)) add(key(t.envelopeId), -t.amount);
    }
    return bal;
}

// What an Envelope still needs this month (R9–R11). Both Target kinds are
// counted once a month (D8), so a second payday does not refill an Envelope
// that was already funded and then spent.
function neededOf(envelope, assignedThisMonth, balanceAtMonthStart) {
    const target = envelope.target;
    if (!target) return 0;
    const gap = target.kind === "fillTo"
        ? target.amount - balanceAtMonthStart - assignedThisMonth
        : target.amount - assignedThisMonth;
    return Math.max(0, gap);
}

function summarize(data, today) {
    const month = monthOf(today);
    const balances = balancesOf(data);
    const atMonthStart = balancesOf(data, startOfMonth(today));

    const assignedThisMonth = new Map();
    for (const a of data.assignments) {
        if (monthOf(a.date) !== month) continue;
        const id = key(a.envelopeId);
        assignedThisMonth.set(id, (assignedThisMonth.get(id) || 0) + a.amount);
    }

    const envelopes = {};
    for (const e of data.envelopes) {
        const id = key(e._id);
        envelopes[id] = {
            balance: balances.get(id) || 0,
            needed: neededOf(e, assignedThisMonth.get(id) || 0, atMonthStart.get(id) || 0),
        };
    }
    return { unassigned: unassignedOf(data), envelopes };
}

// The Assignments Fund targets would record (R14): active Envelopes in sort
// order, each up to what it still needs, until Unassigned runs out.
function fundTargets(data, today) {
    const { unassigned, envelopes } = summarize(data, today);
    let left = unassigned;
    const plan = [];

    const active = data.envelopes
        .filter((e) => !e.archived)
        .sort((a, b) => a.sortOrder - b.sortOrder);

    for (const e of active) {
        if (left <= 0) break;
        const amount = Math.min(envelopes[key(e._id)].needed, left);
        if (amount <= 0) continue;
        plan.push({ envelopeId: key(e._id), amount });
        left -= amount;
    }
    return plan;
}

module.exports = { summarize, fundTargets, balancesOf, unassignedOf };
