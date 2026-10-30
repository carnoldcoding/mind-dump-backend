// Finances — service-layer tests against an in-memory repository, the same
// split Mind uses: the rules that refuse a write and the catch-up that records
// Scheduled transactions are checked here, and the Mongo repository
// (repository.js) is the untested I/O half.
// (describe/it/expect are Vitest globals — see vitest.config.js.)

const service = require("./service");
const { FinanceError } = require("./errors");

function inMemoryRepo() {
    const tables = { envelopes: [], transactions: [], assignments: [], schedules: [] };
    let next = 1;
    const find = (kind, id) => tables[kind].find((d) => d._id === String(id));
    return {
        tables,
        async list(kind) { return tables[kind].map((d) => ({ ...d })); },
        async get(kind, id) { const d = find(kind, id); return d ? { ...d } : null; },
        async insert(kind, doc) { const d = { ...doc, _id: String(next++) }; tables[kind].push(d); return { ...d }; },
        async insertMany(kind, docs) { for (const d of docs) await this.insert(kind, d); },
        async update(kind, id, fields) { const d = find(kind, id); if (!d) return false; Object.assign(d, fields); return true; },
        async remove(kind, id) { const n = tables[kind].length; tables[kind] = tables[kind].filter((d) => d._id !== String(id)); return tables[kind].length < n; },
        async claimSchedule(id, expected, last) {
            const d = find("schedules", id);
            if (!d || d.lastRecorded !== expected) return false;
            d.lastRecorded = last;
            return true;
        },
    };
}

async function rejects(promise, code) {
    await expect(promise).rejects.toBeInstanceOf(FinanceError);
    await expect(promise).rejects.toMatchObject({ code });
}

async function seeded() {
    const repo = inMemoryRepo();
    const groceries = await service.addEnvelope(repo, { name: "Groceries" });
    const fun = await service.addEnvelope(repo, { name: "Fun" });
    await service.addTransaction(repo, { date: "2026-10-01", amount: 300000, kind: "income" });
    return { repo, groceries: groceries._id, fun: fun._id };
}

describe("Transactions (R2, R3)", () => {
    it("records spending against one Envelope and income against none", async () => {
        const { repo, groceries } = await seeded();
        const t = await service.addTransaction(repo, {
            date: "2026-10-05", amount: 4300, kind: "spending", envelopeId: groceries, payee: " Kroger ", note: "",
        });
        expect(t).toMatchObject({ date: "2026-10-05", amount: 4300, kind: "spending", envelopeId: groceries, payee: "Kroger", note: "" });
        expect(repo.tables.transactions[0].envelopeId).toBeNull();
    });

    it("refuses spending with no Envelope, and income with one", async () => {
        const { repo, groceries } = await seeded();
        await rejects(service.addTransaction(repo, { date: "2026-10-05", amount: 100, kind: "spending" }), "invalid_input");
        await rejects(service.addTransaction(repo, { date: "2026-10-05", amount: 100, kind: "income", envelopeId: groceries }), "invalid_input");
    });

    it("refuses an amount that is not a positive whole number of cents", async () => {
        const { repo, groceries } = await seeded();
        for (const amount of [0, -5, 12.5, "100"]) {
            await rejects(service.addTransaction(repo, { date: "2026-10-05", amount, kind: "spending", envelopeId: groceries }), "invalid_input");
        }
    });

    it("refuses a date that is not a real calendar day", async () => {
        const { repo, groceries } = await seeded();
        await rejects(service.addTransaction(repo, { date: "2026-02-30", amount: 100, kind: "spending", envelopeId: groceries }), "invalid_input");
    });

    it("allows one starting balance only", async () => {
        const { repo } = await seeded();
        const first = await service.addTransaction(repo, { date: "2026-10-01", amount: 500000, kind: "income", startingBalance: true });
        await rejects(service.addTransaction(repo, { date: "2026-10-02", amount: 1, kind: "income", startingBalance: true }), "starting_balance_exists");
        // Editing the one that has it keeps it.
        await service.updateTransaction(repo, first._id, { date: "2026-10-01", amount: 510000, kind: "income", startingBalance: true });
    });

    it("refuses a starting balance on spending", async () => {
        const { repo, groceries } = await seeded();
        await rejects(service.addTransaction(repo, { date: "2026-10-01", amount: 1, kind: "spending", envelopeId: groceries, startingBalance: true }), "invalid_input");
    });
});

describe("Assignments (R15–R17)", () => {
    it("refuses a new Assignment larger than Unassigned", async () => {
        const { repo, groceries } = await seeded();
        await rejects(service.addAssignment(repo, { date: "2026-10-01", amount: 300001, envelopeId: groceries }), "over_unassigned");
        await service.addAssignment(repo, { date: "2026-10-01", amount: 300000, envelopeId: groceries });
    });

    // A move does not come out of Unassigned, so the cap does not apply.
    it("moves between Envelopes whatever Unassigned holds", async () => {
        const { repo, groceries, fun } = await seeded();
        await service.addAssignment(repo, { date: "2026-10-01", amount: 300000, envelopeId: fun });
        await service.addAssignment(repo, { date: "2026-10-06", amount: 3000, envelopeId: groceries, sourceEnvelopeId: fun });
        const { summary } = await service.load(repo, "2026-10-07");
        expect(summary.envelopes[groceries].balance).toBe(3000);
        expect(summary.envelopes[fun].balance).toBe(297000);
    });

    it("refuses a move from an Envelope into itself", async () => {
        const { repo, fun } = await seeded();
        await rejects(service.addAssignment(repo, { date: "2026-10-01", amount: 1, envelopeId: fun, sourceEnvelopeId: fun }), "invalid_input");
    });

    // R12: an edit may push Unassigned negative; the window shows it in red.
    it("lets an edit exceed Unassigned", async () => {
        const { repo, groceries } = await seeded();
        const a = await service.addAssignment(repo, { date: "2026-10-01", amount: 1000, envelopeId: groceries });
        await service.updateAssignment(repo, a._id, { date: "2026-10-01", amount: 400000, envelopeId: groceries });
        const { summary } = await service.load(repo, "2026-10-02");
        expect(summary.unassigned).toBe(-100000);
    });

    it("refuses an Assignment to an Envelope that does not exist", async () => {
        const { repo } = await seeded();
        await rejects(service.addAssignment(repo, { date: "2026-10-01", amount: 1, envelopeId: "999" }), "not_found");
    });
});

describe("Fund targets (R14)", () => {
    it("records one Assignment per funded Envelope, dated today", async () => {
        const { repo, groceries } = await seeded();
        await service.updateEnvelope(repo, groceries, { target: { kind: "fillTo", amount: 40000 } });
        const plan = await service.fundTargets(repo, "2026-10-02");
        expect(plan).toEqual([{ envelopeId: groceries, amount: 40000 }]);
        expect(repo.tables.assignments).toMatchObject([{ date: "2026-10-02", amount: 40000, envelopeId: groceries, sourceEnvelopeId: null }]);
    });
});

describe("Envelopes (R18, R19)", () => {
    it("appends new Envelopes to the end of the order, and reorders them", async () => {
        const { repo, groceries, fun } = await seeded();
        expect(repo.tables.envelopes.map((e) => e.sortOrder)).toEqual([0, 1]);
        await service.reorderEnvelopes(repo, [fun, groceries]);
        const { envelopes } = await service.load(repo, "2026-10-02");
        expect(envelopes.map((e) => e._id)).toEqual([fun, groceries]);
    });

    it("refuses to archive an Envelope with money in it", async () => {
        const { repo, fun } = await seeded();
        await service.addAssignment(repo, { date: "2026-10-01", amount: 100, envelopeId: fun });
        await rejects(service.updateEnvelope(repo, fun, { archived: true }), "envelope_not_empty");
    });

    it("refuses to archive an Envelope a schedule uses", async () => {
        const { repo, fun } = await seeded();
        await service.addSchedule(repo, { payee: "Netflix", amount: 1599, kind: "spending", envelopeId: fun, days: [3] }, "2026-10-02");
        await rejects(service.updateEnvelope(repo, fun, { archived: true }), "envelope_scheduled");
    });

    it("archives an empty Envelope and restores it", async () => {
        const { repo, fun } = await seeded();
        await service.updateEnvelope(repo, fun, { archived: true });
        expect(repo.tables.envelopes.find((e) => e._id === fun).archived).toBe(true);
        await service.updateEnvelope(repo, fun, { archived: false });
        expect(repo.tables.envelopes.find((e) => e._id === fun).archived).toBe(false);
    });

    it("refuses a blank name and a malformed target", async () => {
        const { repo, fun } = await seeded();
        await rejects(service.addEnvelope(repo, { name: "  " }), "invalid_input");
        await rejects(service.updateEnvelope(repo, fun, { target: { kind: "saveBy", amount: 100 } }), "invalid_input");
    });
});

describe("Scheduled transactions (R25–R28)", () => {
    const paySchedule = { payee: "Paycheck", amount: 150000, kind: "income", days: [1, 15] };

    // A9: a schedule two months old, opened twice.
    it("records every due day on load, and nothing twice", async () => {
        const repo = inMemoryRepo();
        const s = await service.addSchedule(repo, paySchedule, "2026-08-20");

        const first = await service.load(repo, "2026-10-02");
        expect(first.transactions.map((t) => t.date)).toEqual(["2026-10-01", "2026-09-15", "2026-09-01"]);
        expect(first.transactions[0]).toMatchObject({ amount: 150000, kind: "income", payee: "Paycheck", scheduleId: s._id });

        const second = await service.load(repo, "2026-10-02");
        expect(second.transactions).toHaveLength(3);
    });

    // React's development mode mounts twice, so two loads can run at once.
    it("records a due day once when two loads race", async () => {
        const repo = inMemoryRepo();
        await service.addSchedule(repo, paySchedule, "2026-09-20");
        await Promise.all([service.load(repo, "2026-10-02"), service.load(repo, "2026-10-02")]);
        expect(repo.tables.transactions).toHaveLength(1);
    });

    it("records nothing before the creation date (A10)", async () => {
        const repo = inMemoryRepo();
        await service.addSchedule(repo, paySchedule, "2026-10-20");
        const { transactions } = await service.load(repo, "2026-10-20");
        expect(transactions).toEqual([]);
    });

    it("changes future recordings only when edited (R25)", async () => {
        const repo = inMemoryRepo();
        const s = await service.addSchedule(repo, paySchedule, "2026-09-20");
        await service.load(repo, "2026-10-02");
        await service.updateSchedule(repo, s._id, { ...paySchedule, amount: 160000 });
        const { transactions } = await service.load(repo, "2026-10-16");
        expect(transactions.map((t) => [t.date, t.amount])).toEqual([["2026-10-15", 160000], ["2026-10-01", 150000]]);
    });

    it("refuses days outside 1–31 and an empty day list", async () => {
        const repo = inMemoryRepo();
        await rejects(service.addSchedule(repo, { ...paySchedule, days: [] }, "2026-10-01"), "invalid_input");
        await rejects(service.addSchedule(repo, { ...paySchedule, days: [0, 32] }, "2026-10-01"), "invalid_input");
    });
});

describe("load", () => {
    it("refuses a missing or malformed today", async () => {
        await rejects(service.load(inMemoryRepo(), "10/30/2026"), "invalid_input");
    });

    it("returns Transactions newest first and Envelopes in sort order", async () => {
        const { repo, groceries } = await seeded();
        await service.addTransaction(repo, { date: "2026-10-09", amount: 100, kind: "spending", envelopeId: groceries });
        const { transactions, envelopes } = await service.load(repo, "2026-10-10");
        expect(transactions.map((t) => t.date)).toEqual(["2026-10-09", "2026-10-01"]);
        expect(envelopes.map((e) => e.name)).toEqual(["Groceries", "Fun"]);
    });
});
