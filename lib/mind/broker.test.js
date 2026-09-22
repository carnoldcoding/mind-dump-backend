// Mind — broker tests. Currently just prepareQuestion, the pure option-shuffle
// that keeps the correct answer out of a fixed slot. describe/it/expect are
// Vitest globals (vitest.config.js: globals: true).

const { prepareQuestion } = require("./broker");

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
