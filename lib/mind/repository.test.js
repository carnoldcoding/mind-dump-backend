// Mind — the pure half of the repository: turning projection documents into a
// State. The Mongo I/O around it stays untested by convention (see the note
// atop repository.js).
// (describe/it/expect are Vitest globals — see vitest.config.js.)

const { stateFromDocs } = require("./repository");

const disc = (domain, slug, extra = {}) => ({ _id: `${domain}/${slug}`, domain, slug, title: "", logos: 0, questsSinceBoss: 0, bloodstain: null, ...extra });
const quest = (domain, discipline, slug, extra = {}) => ({
    _id: `${domain}/${discipline}/${slug}`, domain, discipline, slug, title: slug,
    streak: 0, mastered: false, started: false, lore: null, links: [], ...extra,
});

describe("stateFromDocs", () => {
    it("loads a discipline in a domain outside the original three", () => {
        const s = stateFromDocs([disc("cars", "engines", { logos: 100 })], [quest("cars", "engines", "four-stroke-cycle", { streak: 2, started: true })]);
        expect(s.domains.cars.disciplines.engines.logos).toBe(100);
        expect(s.domains.cars.disciplines.engines.quests["four-stroke-cycle"].streak).toBe(2);
        expect(s.openQuests()).toEqual([{ domain: "cars", discipline: "engines", quest: "four-stroke-cycle" }]);
    });

    it("still loads the original domains", () => {
        const s = stateFromDocs([disc("networking", "dns")], [quest("networking", "dns", "resolvers")]);
        expect(s.domains.networking.disciplines.dns.quests.resolvers).toBeTruthy();
    });

    it("skips a discipline whose domain slug is malformed, and its quests", () => {
        const s = stateFromDocs([disc("Bad Slug", "x")], [quest("Bad Slug", "x", "q")]);
        expect(s.domains).toEqual({});
    });

    it("skips an orphan quest", () => {
        const s = stateFromDocs([], [quest("cars", "engines", "q")]);
        expect(s.domains).toEqual({});
    });
});
