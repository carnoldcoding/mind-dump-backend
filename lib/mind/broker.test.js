// Mind — broker tests: prepareQuestion (the option shuffle that keeps the
// correct answer out of a fixed slot), and the pieces around a graded click
// that decide what the model may record and what it is told afterwards.
// describe/it/expect are Vitest globals (vitest.config.js: globals: true).

const { prepareQuestion, applyModelActions, followUpMessage, teach, answer, MODEL, MIND_EFFORT, TURN_SCHEMA } = require("./broker");
const { State } = require("./state");

const q = () => ({
    stem: "Which resolves a name to an address?",
    correctId: "a", // Claude reliably makes the correct option first.
    domain: "networking",
    discipline: "dns",
    quest: "nameserver-vs-resolver",
    options: [
        { id: "a", text: "The resolver" },
        { id: "b", text: "The router" },
        { id: "c", text: "The switch" },
        { id: "d", text: "The gateway" },
    ],
});

describe("prepareQuestion", () => {
    it("returns null/passes through when there is no question", () => {
        expect(prepareQuestion(null)).toBe(null);
        expect(prepareQuestion(undefined)).toBe(null);
        expect(prepareQuestion({ stem: "open?" })).toEqual({ stem: "open?" });
    });

    it("relabels ids a/b/c/d by final position, whatever order they land in", () => {
        const out = prepareQuestion(q(), () => 0); // rng=0 → deterministic order
        expect(out.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("keeps every option's text, none lost or duplicated", () => {
        const before = q().options.map((o) => o.text).sort();
        const after = prepareQuestion(q(), Math.random).options.map((o) => o.text).sort();
        expect(after).toEqual(before);
    });

    it("moves the originally-first option out of slot a when the shuffle says so", () => {
        // rng=0 makes each Fisher–Yates step pick j=0, walking element 0 to the end.
        const out = prepareQuestion(q(), () => 0);
        const correct = out.options.find((o) => o.text === "The resolver");
        expect(correct.id).not.toBe("a");
    });

    it("remaps correctId to wherever the correct option lands", () => {
        const out = prepareQuestion(q(), () => 0); // resolver walks to the last slot ("d")
        const correctOpt = out.options.find((o) => o.text === "The resolver");
        expect(out.correctId).toBe(correctOpt.id);
        expect(out.correctId).not.toBe("a");
    });

    it("carries the quest ref through for backend grading", () => {
        const out = prepareQuestion(q(), () => 0.5);
        expect(out.domain).toBe("networking");
        expect(out.discipline).toBe("dns");
        expect(out.quest).toBe("nameserver-vs-resolver");
    });

    it("preserves the stem", () => {
        expect(prepareQuestion(q(), () => 0.5).stem).toBe("Which resolves a name to an address?");
    });
});

describe("applyModelActions", () => {
    function repo() {
        const state = new State();
        return { state, async loadState() { return state; }, async saveState() {}, async appendEvents() {} };
    }

    it("drops recordAnswer and recordRecall, which the backend records itself", async () => {
        const r = repo();
        const results = await applyModelActions(r, [
            { op: "recordAnswer", domain: "networking", discipline: "dns", quest: "x", correct: true },
            { op: "recordRecall", domain: "networking", discipline: "dns", quest: "x", correct: true },
            { op: "startQuest", domain: "networking", discipline: "dns", quest: "x", title: "X" },
        ], null);
        expect(results.map((x) => x.op)).toEqual(["startQuest"]);
        expect(r.state.domains.networking.disciplines.dns.quests.x.streak).toBe(0);
    });
});

describe("followUpMessage", () => {
    const base = { stem: "Q?", chosenText: "A", rightText: "A", correct: true };

    it("lists the recalls still due after a recall", () => {
        const msg = followUpMessage({
            ...base, kind: "recall",
            due: [{ title: "VNet peering", domain: "networking", discipline: "cloud-networking", slug: "vnet-peering" }],
        });
        expect(msg).toContain("RECALL");
        expect(msg).toContain("PASSED");
        expect(msg).toContain("Recalls still due: 1 — VNet peering (networking/cloud-networking/vnet-peering)");
    });

    it("says recalls are done when none remain", () => {
        const msg = followUpMessage({ ...base, correct: false, kind: "recall", due: [] });
        expect(msg).toContain("FAILED");
        expect(msg).toContain("No recalls remain due");
    });

    it("says a practice answer was not recorded", () => {
        expect(followUpMessage({ ...base, kind: "practice" })).toContain("not recorded");
    });

    it("says nothing about recalls on a mastery answer", () => {
        const msg = followUpMessage({ ...base, kind: "mastery" });
        expect(msg).not.toContain("RECALL");
        expect(msg).not.toMatch(/recalls (still|remain)/i);
    });
});

// A turn end to end with the Claude call stubbed: a repo that holds one session,
// and a runClaude stand-in that records what it was asked and returns `turn`.
describe("teach and answer (headless Claude stubbed)", () => {
    function sessionRepo() {
        const state = new State();
        const session = { _id: "s1", transcript: [], pendingQuestion: null };
        return {
            state,
            session,
            async loadState() { return state; },
            async saveState() {},
            async appendEvents() {},
            async allQuests() { return []; },
            async allDisciplines() { return []; },
            async getSession() { return session; },
            async setPendingQuestion(_id, p) { session.pendingQuestion = p; },
            async appendTranscript(_id, entries) { session.transcript.push(...entries); },
        };
    }
    function stub(turn) {
        const calls = [];
        const runClaude = async (args) => { calls.push(args); return { structured: turn, usage: {}, durationMs: 1 }; };
        return { runClaude, calls };
    }

    it("sends the model, effort, methodology, schema, and the context + learner prompt", async () => {
        const r = sessionRepo();
        const { runClaude, calls } = stub({ say: "hello", actions: [] });
        await teach(r, { sessionId: "s1", userMessage: "teach me DNS" }, { runClaude });
        expect(calls[0].model).toBe(MODEL);
        expect(calls[0].effort).toBe(MIND_EFFORT);
        expect(calls[0].schema).toBe(TURN_SCHEMA);
        expect(calls[0].system.length).toBeGreaterThan(0);
        expect(calls[0].prompt).toMatch(/^CURRENT STATE:\n/);
        expect(calls[0].prompt).toMatch(/LEARNER:\nteach me DNS$/);
    });

    it("uses Opus 5.5 at medium effort", () => {
        expect(MODEL).toBe("claude-opus-5-5");
        expect(MIND_EFFORT).toBe("medium");
    });

    it("applies the turn: says, stashes the question key, writes the transcript", async () => {
        const r = sessionRepo();
        const { runClaude } = stub({ say: "Which one?", question: q(), actions: [] });
        const out = await teach(r, { sessionId: "s1", userMessage: "go" }, { runClaude });
        expect(out.say).toBe("Which one?");
        expect(out.question.options).toHaveLength(4);
        expect(out.question.correctId).toBeUndefined();
        expect(r.session.pendingQuestion.correctId).toBeTruthy();
        expect(r.session.transcript.map((t) => t.content)).toEqual(["go", "Which one?"]);
    });

    it("writes nothing when the Claude call fails", async () => {
        const r = sessionRepo();
        r.session.pendingQuestion = { correctId: "a" };
        const runClaude = async () => { throw Object.assign(new Error("limit"), { code: "claude_limit" }); };
        await expect(teach(r, { sessionId: "s1", userMessage: "go" }, { runClaude })).rejects.toMatchObject({ code: "claude_limit" });
        expect(r.session.transcript).toEqual([]);
        expect(r.session.pendingQuestion).toEqual({ correctId: "a" });
    });

    it("refuses a second turn on a session while one is running", async () => {
        const r = sessionRepo();
        let release;
        const runClaude = () => new Promise((res) => { release = () => res({ structured: { say: "ok", actions: [] }, usage: {}, durationMs: 1 }); });
        const first = teach(r, { sessionId: "s1", userMessage: "one" }, { runClaude });
        await expect(teach(r, { sessionId: "s1", userMessage: "two" }, { runClaude })).rejects.toMatchObject({ code: "turn_in_progress" });
        await expect(answer(r, { sessionId: "s1", optionId: "a" }, { runClaude })).rejects.toMatchObject({ code: "turn_in_progress" });
        await new Promise((res) => setImmediate(res));
        release();
        await first;
        // Free again once the first turn finishes.
        const { runClaude: next } = stub({ say: "again", actions: [] });
        await expect(teach(r, { sessionId: "s1", userMessage: "three" }, { runClaude: next })).resolves.toMatchObject({ say: "again" });
    });

    it("frees the session after a failed turn", async () => {
        const r = sessionRepo();
        const bad = async () => { throw Object.assign(new Error("x"), { code: "claude_failed" }); };
        await expect(teach(r, { sessionId: "s1", userMessage: "one" }, { runClaude: bad })).rejects.toBeTruthy();
        const { runClaude } = stub({ say: "fine", actions: [] });
        await expect(teach(r, { sessionId: "s1", userMessage: "two" }, { runClaude })).resolves.toMatchObject({ say: "fine" });
    });
});
