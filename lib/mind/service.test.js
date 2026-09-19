// Mind — service-layer tests against an in-memory repository. These verify the
// whole flow (load → transition → build events → persist → authoritative view)
// including event generation, without needing Mongo. The Mongo repository
// (repository.js) is the I/O half and is left untested by convention.
// (describe/it/expect are Vitest globals — see vitest.config.js.)

const { State } = require("./state");
const service = require("./service");
const { DevOps, QuestLogos, BossWinLogos } = require("./index");

// A repository backed by a live in-memory State. loadState hands back the same
// object each call (saveState is then a no-op), which is exactly how the Mongo
// repo behaves logically: mutate the materialised state, write it back.
function inMemoryRepo() {
    const state = new State();
    const log = [];
    return {
        state,
        events: log,
        async loadState() { return state; },
        async saveState() { /* same object; real repo upserts here */ },
        async appendEvents(evs) { log.push(...evs); },
    };
}

const ref = { domain: DevOps, discipline: "containers", quest: "namespaces", title: "Namespaces" };

describe("service.recordAnswer", () => {
    it("logs an answer event on a plain correct answer", async () => {
        const repo = inMemoryRepo();
        const r = await service.recordAnswer(repo, { ...ref, correct: true, sessionId: "s1" });
        expect(r.quest.streak).toBe(1);
        expect(r.quest.mastered).toBe(false);
        expect(repo.events).toHaveLength(1);
        expect(repo.events[0]).toMatchObject({ op: "answer", correct: true, sessionId: "s1", quest: "namespaces" });
    });

    it("emits answer + mastered events and awards logos on the third correct", async () => {
        const repo = inMemoryRepo();
        await service.recordAnswer(repo, { ...ref, correct: true });
        await service.recordAnswer(repo, { ...ref, correct: true });
        const r = await service.recordAnswer(repo, { ...ref, correct: true });
        expect(r.quest.mastered).toBe(true);
        expect(r.outcome.logosAwarded).toBe(QuestLogos);
        expect(r.discipline.logos).toBe(QuestLogos);
        expect(r.discipline.level).toBe(2);
        // last call emitted both answer and mastered
        const last = repo.events.slice(-2).map((e) => e.op);
        expect(last).toEqual(["answer", "mastered"]);
        expect(repo.events.at(-1)).toMatchObject({ op: "mastered", logosDelta: QuestLogos });
    });

    it("does not emit a mastered event on a no-op call to an already-mastered quest", async () => {
        const repo = inMemoryRepo();
        for (let i = 0; i < 3; i++) await service.recordAnswer(repo, { ...ref, correct: true });
        const before = repo.events.length;
        await service.recordAnswer(repo, { ...ref, correct: true });
        expect(repo.events.length).toBe(before + 1); // just the answer
        expect(repo.events.at(-1).op).toBe("answer");
    });
});

describe("service.recordRecall", () => {
    it("advances a tier and logs a recall event", async () => {
        const repo = inMemoryRepo();
        for (let i = 0; i < 3; i++) await service.recordAnswer(repo, { ...ref, correct: true });
        const r = await service.recordRecall(repo, { ...ref, correct: true });
        expect(r.quest.recallTier).toBe(1);
        expect(repo.events.at(-1)).toMatchObject({ op: "recall", correct: true, tierBefore: 0, tierAfter: 1 });
    });

    it("emits a prestige event when passing the final tier", async () => {
        const repo = inMemoryRepo();
        for (let i = 0; i < 3; i++) await service.recordAnswer(repo, { ...ref, correct: true });
        let r;
        for (let i = 0; i < 5; i++) r = await service.recordRecall(repo, { ...ref, correct: true });
        expect(r.quest.prestiged).toBe(true);
        expect(repo.events.at(-1).op).toBe("prestige");
    });
});

describe("service.attemptBoss", () => {
    it("resolves a win, awards logos, and logs a boss event", async () => {
        const repo = inMemoryRepo();
        // master three quests in the discipline to unlock the boss
        for (const q of ["a", "b", "c"]) {
            for (let i = 0; i < 3; i++) {
                await service.recordAnswer(repo, { domain: DevOps, discipline: "containers", quest: q, title: q, correct: true });
            }
        }
        const r = await service.attemptBoss(repo, { domain: DevOps, discipline: "containers", won: true, sessionId: "s1" });
        expect(r.result.logosDelta).toBe(BossWinLogos);
        expect(r.discipline.logos).toBe(3 * QuestLogos + BossWinLogos);
        expect(r.discipline.bossAvailable).toBe(false); // re-locked
        expect(repo.events.at(-1)).toMatchObject({ op: "boss", won: true, logosDelta: BossWinLogos });
    });
});

describe("service.startQuest & dueRecalls", () => {
    it("creates an un-started quest and logs a startQuest event", async () => {
        const repo = inMemoryRepo();
        const r = await service.startQuest(repo, ref);
        expect(r.outcome.created).toBe(true);
        expect(r.quest.streak).toBe(0);
        expect(r.quest.mastered).toBe(false);
        expect(repo.events.at(-1)).toMatchObject({ op: "startQuest", quest: "namespaces" });
    });

    it("re-starting an existing quest is a no-op with no event", async () => {
        const repo = inMemoryRepo();
        await service.startQuest(repo, ref);
        const before = repo.events.length;
        const r = await service.startQuest(repo, ref);
        expect(r.outcome.created).toBe(false);
        expect(repo.events.length).toBe(before);
    });

    it("dueRecalls returns mastered quests past their due date", async () => {
        const repo = inMemoryRepo();
        for (let i = 0; i < 3; i++) await service.recordAnswer(repo, { ...ref, correct: true });
        const future = new Date(Date.now() + 2 * 86400e3); // 2 days out, past the tier-0 (1 day) due
        const due = await service.dueRecalls(repo, future);
        expect(due.map((q) => q.slug)).toContain("namespaces");
    });
});
