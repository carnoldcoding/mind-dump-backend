// Finances — the budget arithmetic (spec R7–R11, R14). Every number on the
// Envelopes tab comes from here, so the cases are the spec's own acceptance
// examples, worked by hand, in cents.
// (describe/it/expect are Vitest globals — see vitest.config.js.)

const { summarize, fundTargets } = require("./budget");

const envelope = (id, target = null, sortOrder = 0) => ({ _id: id, name: id, sortOrder, target, archived: false });
const income = (date, amount) => ({ date, amount, kind: "income", envelopeId: null });
const spend = (date, amount, envelopeId) => ({ date, amount, kind: "spending", envelopeId });
const assign = (date, amount, envelopeId, sourceEnvelopeId = null) => ({ date, amount, envelopeId, sourceEnvelopeId });

describe("moves back to Unassigned (envelope-ux R19–R21)", () => {
    // A15: $100 from Savings to Unassigned.
    it("raises Unassigned and lowers the source Envelope by the move", () => {
        const s = summarize({
            envelopes: [envelope("savings")],
            transactions: [income("2026-11-01", 50000)],
            assignments: [
                assign("2026-11-01", 50000, "savings"),
                assign("2026-11-02", 10000, null, "savings"),
            ],
        }, "2026-11-02");

        expect(s.unassigned).toBe(10000);
        expect(s.envelopes.savings.balance).toBe(40000);
    });

    // A16: Food funded to its $500 Target, then $50 moved out.
    it("leaves a funded Envelope's needed amount at $0 after a move out", () => {
        const s = summarize({
            envelopes: [envelope("food", { kind: "fillTo", amount: 50000 })],
            transactions: [income("2026-11-01", 50000)],
            assignments: [
                assign("2026-11-01", 50000, "food"),
                assign("2026-11-02", 5000, null, "food"),
            ],
        }, "2026-11-02");

        expect(s.envelopes.food.needed).toBe(0);
        expect(s.envelopes.food.balance).toBe(45000);
    });

    it("lets Fund targets spend money moved back to Unassigned", () => {
        const plan = fundTargets({
            envelopes: [envelope("savings", null, 0), envelope("subs", { kind: "fillTo", amount: 17000 }, 1)],
            transactions: [income("2026-11-01", 107000)],
            assignments: [
                assign("2026-11-01", 7000, "subs"),
                assign("2026-11-01", 100000, "savings"),
                assign("2026-11-02", 10000, null, "savings"),
            ],
        }, "2026-11-02");

        expect(plan).toEqual([{ envelopeId: "subs", amount: 10000 }]);
    });
});

describe("the unclamped gap (envelope-ux R14, R16)", () => {
    // Groceries: fillTo $400, $150 at the start of November, $300 assigned
    // in November. Needed is $0; the gap is −$50, so a $100 cut in an
    // edit leaves it needing $50.
    it("reports the gap below $0 that needed clamps away", () => {
        const s = summarize({
            envelopes: [envelope("groceries", { kind: "fillTo", amount: 40000 })],
            transactions: [income("2026-10-01", 100000)],
            assignments: [assign("2026-10-01", 15000, "groceries"), assign("2026-11-01", 30000, "groceries")],
        }, "2026-11-02");

        expect(s.envelopes.groceries.needed).toBe(0);
        expect(s.envelopes.groceries.gap).toBe(-5000);
    });

    it("reports a gap of $0 for an Envelope with no Target", () => {
        const s = summarize({
            envelopes: [envelope("savings")],
            transactions: [income("2026-11-01", 100000)],
            assignments: [assign("2026-11-01", 10000, "savings")],
        }, "2026-11-02");

        expect(s.envelopes.savings.gap).toBe(0);
    });
});

describe("balances and Unassigned (R7, R8)", () => {
    // A2: $3,000 in, $400 to Groceries, $430 spent.
    it("leaves $2,600 Unassigned and Groceries at −$30", () => {
        const s = summarize({
            envelopes: [envelope("groceries")],
            transactions: [income("2026-10-01", 300000), spend("2026-10-05", 43000, "groceries")],
            assignments: [assign("2026-10-01", 40000, "groceries")],
        }, "2026-10-20");

        expect(s.unassigned).toBe(260000);
        expect(s.envelopes.groceries.balance).toBe(-3000);
    });

    it("moves money between Envelopes without touching Unassigned (R16)", () => {
        const s = summarize({
            envelopes: [envelope("groceries"), envelope("fun")],
            transactions: [income("2026-10-01", 100000), spend("2026-10-05", 43000, "groceries")],
            assignments: [
                assign("2026-10-01", 40000, "groceries"),
                assign("2026-10-01", 25000, "fun"),
                assign("2026-10-06", 3000, "groceries", "fun"),
            ],
        }, "2026-10-20");

        expect(s.envelopes.groceries.balance).toBe(0);
        expect(s.envelopes.fun.balance).toBe(22000);
        expect(s.unassigned).toBe(35000);
    });

    // Leftover money carries over: nothing resets at a month boundary (D7).
    it("carries a balance across months", () => {
        const s = summarize({
            envelopes: [envelope("fun")],
            transactions: [income("2026-10-01", 50000), spend("2026-10-10", 10000, "fun")],
            assignments: [assign("2026-10-01", 25000, "fun"), assign("2026-11-01", 25000, "fun")],
        }, "2026-11-02");

        expect(s.envelopes.fun.balance).toBe(40000);
    });

    it("matches ids given as ObjectId-like values", () => {
        const id = { toString: () => "abc" };
        const s = summarize({
            envelopes: [{ ...envelope("abc"), _id: id }],
            transactions: [income("2026-10-01", 1000)],
            assignments: [assign("2026-10-01", 600, { toString: () => "abc" })],
        }, "2026-10-02");

        expect(s.envelopes.abc.balance).toBe(600);
    });
});

describe("still needed this month (R9–R11)", () => {
    const fillTo = (amount) => ({ kind: "fillTo", amount });
    const addMonthly = (amount) => ({ kind: "addMonthly", amount });

    // A3: Groceries fill to $400, starting October with $150.
    const groceries = (assignments, transactions = []) => summarize({
        envelopes: [envelope("groceries", fillTo(40000))],
        transactions: [income("2026-09-01", 100000), spend("2026-09-10", 25000, "groceries"), ...transactions],
        assignments: [assign("2026-09-01", 40000, "groceries"), ...assignments],
    }, "2026-10-15").envelopes.groceries.needed;

    it("needs the gap to the target at the start of the month", () => {
        expect(groceries([])).toBe(25000);
    });

    it("needs nothing more once this month's gap is assigned, however much is spent", () => {
        expect(groceries([assign("2026-10-01", 25000, "groceries")], [spend("2026-10-05", 35000, "groceries")])).toBe(0);
    });

    it("counts a move from another Envelope as assigned this month", () => {
        expect(groceries([assign("2026-10-03", 10000, "groceries", "fun")])).toBe(15000);
    });

    it("never needs less than zero", () => {
        expect(groceries([assign("2026-10-01", 90000, "groceries")])).toBe(0);
    });

    // A4: Car Insurance adds $150 a month, whatever its $900 balance.
    it("needs the monthly amount for an add-each-month target, ignoring the balance", () => {
        const s = summarize({
            envelopes: [envelope("insurance", addMonthly(15000))],
            transactions: [income("2026-04-01", 90000)],
            assignments: [assign("2026-04-01", 90000, "insurance")],
        }, "2026-10-15");

        expect(s.envelopes.insurance.needed).toBe(15000);
    });

    it("needs nothing for an Envelope with no target", () => {
        const s = summarize({ envelopes: [envelope("savings")], transactions: [], assignments: [] }, "2026-10-15");
        expect(s.envelopes.savings.needed).toBe(0);
    });
});

describe("Fund targets (R14)", () => {
    // A5: $100 Unassigned, Envelopes needing $80 then $50, in sort order.
    it("funds in sort order until Unassigned runs out", () => {
        const plan = fundTargets({
            envelopes: [
                envelope("second", { kind: "addMonthly", amount: 5000 }, 2),
                envelope("first", { kind: "addMonthly", amount: 8000 }, 1),
            ],
            transactions: [income("2026-10-01", 10000)],
            assignments: [],
        }, "2026-10-01");

        expect(plan).toEqual([
            { envelopeId: "first", amount: 8000 },
            { envelopeId: "second", amount: 2000 },
        ]);
    });

    it("skips archived Envelopes and ones that need nothing", () => {
        const plan = fundTargets({
            envelopes: [
                { ...envelope("old", { kind: "addMonthly", amount: 5000 }, 1), archived: true },
                envelope("full", { kind: "fillTo", amount: 5000 }, 2),
                envelope("fun", { kind: "addMonthly", amount: 3000 }, 3),
            ],
            transactions: [income("2026-10-01", 20000)],
            assignments: [assign("2026-10-01", 5000, "full")],
        }, "2026-10-02");

        expect(plan).toEqual([{ envelopeId: "fun", amount: 3000 }]);
    });

    it("plans nothing when Unassigned is zero or negative", () => {
        const plan = fundTargets({
            envelopes: [envelope("fun", { kind: "addMonthly", amount: 3000 })],
            transactions: [income("2026-10-01", 1000)],
            assignments: [assign("2026-10-01", 2000, "other")],
        }, "2026-10-02");

        expect(plan).toEqual([]);
    });
});
