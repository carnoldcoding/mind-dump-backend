// Mind — domain-logic tests, ported 1:1 from Grimoire's Go tests
// (leveling_test.go, state_test.go, review_test.go → recall, boss_test.go,
// cap_test.go). Passing this suite proves the JS port matches the Go original
// it retires. Names/behaviours are faithful; "review" is "recall" here.

// describe/it/expect are Vitest globals (vitest.config.js: globals: true) —
// this repo's tests stay require-based, so we do not import from "vitest".
const {
    State,
    addDays,
    levelForLogos,
    thresholdForLevel,
    averageLevel,
    MasteryStreak,
    QuestLogos,
    BossWinLogos,
    BossLoseLogos,
    RecallLadderDays,
    Networking,
    DevOps,
    Sysadmin,
    ErrDisciplineLocked,
} = require("./index");

// ── helpers (ported from the Go test helpers) ──────────────────────────────

function masterOne(s, domain, discipline, quest) {
    let title = quest;
    for (let i = 0; i < MasteryStreak; i++) {
        s.recordQuestProgress(domain, discipline, quest, title, true);
        title = "";
    }
}

let questCounter = 0;
function questSlugFor(i) {
    return "q" + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(48 + Math.floor(i / 26));
}
function masterN(s, domain, discipline, n) {
    for (let i = 0; i < n; i++) {
        questCounter++;
        const slug = questSlugFor(questCounter);
        for (let j = 0; j < MasteryStreak; j++) {
            s.recordQuestProgress(domain, discipline, slug, j === 0 ? slug : "", true);
        }
    }
}

// ── leveling ───────────────────────────────────────────────────────────────

describe("leveling", () => {
    it("levelForLogos maps cumulative logos to level", () => {
        const cases = [
            [0, 1], [99, 1], [100, 2], [299, 2], [300, 3], [599, 3],
            [600, 4], [899, 4], [900, 5], [1199, 5], [1200, 6],
        ];
        for (const [logos, want] of cases) expect(levelForLogos(logos)).toBe(want);
    });

    it("thresholdForLevel is the cumulative curve", () => {
        const cases = [[1, 0], [2, 100], [3, 300], [4, 600], [5, 900], [6, 1200], [7, 1500]];
        for (const [level, want] of cases) expect(thresholdForLevel(level)).toBe(want);
    });

    it("threshold and levelForLogos are inverses", () => {
        for (let level = 1; level <= 20; level++) {
            expect(levelForLogos(thresholdForLevel(level))).toBe(level);
        }
    });

    it("averageLevel means the levels, baseline 1 when empty", () => {
        expect(averageLevel(null)).toBe(1);
        expect(averageLevel([1])).toBe(1);
        expect(averageLevel([2, 4])).toBe(3);
        expect(averageLevel([1, 2, 3])).toBe(2);
        expect(averageLevel([5, 6])).toBe(5.5);
    });
});

// ── quest progress / mastery ────────────────────────────────────────────────

describe("recordQuestProgress", () => {
    it("returns title for existing quest, slug fallback for unknown", () => {
        const s = new State();
        s.recordQuestProgress(DevOps, "containers", "namespaces", "Namespaces & cgroups", true);
        expect(s.questTitle({ domain: DevOps, discipline: "containers", quest: "namespaces" })).toBe("Namespaces & cgroups");
        expect(s.questTitle({ domain: DevOps, discipline: "containers", quest: "nonexistent" })).toBe("nonexistent");
    });

    it("creates a new quest with a title", () => {
        const s = new State();
        const out = s.recordQuestProgress(DevOps, "containers", "namespaces", "Namespaces & cgroups", true);
        expect(out.created).toBe(true);
        const q = s.domains[DevOps].disciplines["containers"].quests["namespaces"];
        expect(q.streak).toBe(1);
        expect(q.title).toBe("Namespaces & cgroups");
    });

    it("errors on a new quest without a title", () => {
        const s = new State();
        expect(() => s.recordQuestProgress(DevOps, "containers", "namespaces", "", true)).toThrow();
    });

    it("does not require a title on subsequent calls", () => {
        const s = new State();
        s.recordQuestProgress(DevOps, "containers", "namespaces", "Namespaces", true);
        expect(() => s.recordQuestProgress(DevOps, "containers", "namespaces", "", true)).not.toThrow();
    });

    it("masters on three correct in a row and awards logos once", () => {
        const s = new State();
        let out;
        for (let i = 0; i < 3; i++) out = s.recordQuestProgress(DevOps, "containers", "namespaces", "Namespaces", true);
        expect(out.mastered).toBe(true);
        expect(out.logosAwarded).toBe(QuestLogos);
        expect(s.domains[DevOps].disciplines["containers"].quests["namespaces"].mastered).toBe(true);
        expect(s.domains[DevOps].disciplines["containers"].logos).toBe(QuestLogos);
    });

    it("resets the streak on an incorrect answer", () => {
        const s = new State();
        s.recordQuestProgress(DevOps, "containers", "namespaces", "Namespaces", true);
        s.recordQuestProgress(DevOps, "containers", "namespaces", "", true);
        const out = s.recordQuestProgress(DevOps, "containers", "namespaces", "", false);
        expect(out.streak).toBe(0);
        expect(out.mastered).toBe(false);
    });

    it("does not double-award logos on an already-mastered quest", () => {
        const s = new State();
        for (let i = 0; i < 3; i++) s.recordQuestProgress(DevOps, "containers", "namespaces", "Namespaces", true);
        const out = s.recordQuestProgress(DevOps, "containers", "namespaces", "", true);
        expect(out.logosAwarded).toBe(0);
        expect(s.domains[DevOps].disciplines["containers"].logos).toBe(QuestLogos);
    });

    it("errors on an invalid domain", () => {
        const s = new State();
        expect(() => s.recordQuestProgress("nope", "containers", "namespaces", "Namespaces", true)).toThrow();
    });

    it("never blocks depth within an existing discipline", () => {
        const s = new State();
        s.recordQuestProgress(Networking, "dns", "q1", "Q1", true);
        s.recordQuestProgress(Sysadmin, "systemd", "q2", "Q2", true);
        s.recordQuestProgress(DevOps, "ci-cd", "q3", "Q3", true);
        expect(() => s.recordQuestProgress(Networking, "dns", "q4", "Q4", true)).not.toThrow();
    });
});

// ── recall ladder (Grimoire's review ladder) ────────────────────────────────

describe("recall ladder", () => {
    it("enters the ladder at tier 0 on mastery", () => {
        const s = new State();
        masterOne(s, DevOps, "containers", "namespaces");
        const q = s.domains[DevOps].disciplines["containers"].quests["namespaces"];
        expect(q.recallTier).toBe(0);
        expect(q.prestiged).toBe(false);
        expect(q.nextRecallDue).not.toBeNull();
    });

    it("advances a tier on a pass", () => {
        const s = new State();
        masterOne(s, DevOps, "containers", "namespaces");
        const now = new Date();
        const out = s.recordRecall(DevOps, "containers", "namespaces", true, now);
        expect(out.tierBefore).toBe(0);
        expect(out.tierAfter).toBe(1);
        const q = s.domains[DevOps].disciplines["containers"].quests["namespaces"];
        expect(q.nextRecallDue.getTime()).toBe(addDays(now, RecallLadderDays[1]).getTime());
    });

    it("demotes exactly one tier on a fail", () => {
        const s = new State();
        masterOne(s, DevOps, "containers", "namespaces");
        const now = new Date();
        s.recordRecall(DevOps, "containers", "namespaces", true, now);
        s.recordRecall(DevOps, "containers", "namespaces", true, now);
        const out = s.recordRecall(DevOps, "containers", "namespaces", false, now);
        expect(out.tierAfter).toBe(1);
    });

    it("floors demotion at tier 0", () => {
        const s = new State();
        masterOne(s, DevOps, "containers", "namespaces");
        const out = s.recordRecall(DevOps, "containers", "namespaces", false, new Date());
        expect(out.tierAfter).toBe(0);
    });

    it("prestiges on passing the final tier, awarding no logos", () => {
        const s = new State();
        masterOne(s, DevOps, "containers", "namespaces");
        const now = new Date();
        for (let i = 0; i < RecallLadderDays.length - 1; i++) s.recordRecall(DevOps, "containers", "namespaces", true, now);
        const q = s.domains[DevOps].disciplines["containers"].quests["namespaces"];
        expect(q.recallTier).toBe(RecallLadderDays.length - 1);
        const out = s.recordRecall(DevOps, "containers", "namespaces", true, now);
        expect(out.prestiged).toBe(true);
        expect(q.prestiged).toBe(true);
        expect(s.domains[DevOps].disciplines["containers"].logos).toBe(QuestLogos);
    });

    it("errors recalling a prestiged or unmastered quest", () => {
        const s = new State();
        masterOne(s, DevOps, "containers", "namespaces");
        const now = new Date();
        for (let i = 0; i < RecallLadderDays.length; i++) s.recordRecall(DevOps, "containers", "namespaces", true, now);
        expect(() => s.recordRecall(DevOps, "containers", "namespaces", true, now)).toThrow();

        s.recordQuestProgress(DevOps, "containers", "unstarted", "Unstarted", true);
        expect(() => s.recordRecall(DevOps, "containers", "unstarted", true, now)).toThrow();
    });

    it("dueRecalls respects the due date and excludes prestiged/unmastered", () => {
        const s = new State();
        masterOne(s, DevOps, "containers", "namespaces");
        const q = s.domains[DevOps].disciplines["containers"].quests["namespaces"];
        expect(s.dueRecalls(new Date(q.nextRecallDue.getTime() - 3600e3)).length).toBe(0);
        const due = s.dueRecalls(new Date(q.nextRecallDue.getTime() + 3600e3));
        expect(due.length).toBe(1);
        expect(due[0].quest).toBe("namespaces");
    });

    it("mastered/reviewing quests do not count toward the open-quest cap", () => {
        const s = new State();
        masterOne(s, Networking, "dns", "namespaces");
        s.recordQuestProgress(Sysadmin, "systemd", "q1", "Q1", true);
        s.recordQuestProgress(DevOps, "ci-cd", "q2", "Q2", true);
        expect(() => s.recordQuestProgress(Networking, "security", "q3", "Q3", true)).not.toThrow();
    });
});

// ── boss phases ──────────────────────────────────────────────────────────────

describe("resolveBoss", () => {
    it("is unavailable before three masteries, available after", () => {
        const s = new State();
        masterN(s, DevOps, "containers", 2);
        expect(() => s.resolveBoss(DevOps, "containers", true)).toThrow();
        masterN(s, DevOps, "containers", 1); // now 3
        const res = s.resolveBoss(DevOps, "containers", true);
        expect(res.logosDelta).toBe(BossWinLogos);
        expect(s.domains[DevOps].disciplines["containers"].logos).toBe(300 + BossWinLogos);
    });

    it("re-locks after resolution", () => {
        const s = new State();
        masterN(s, DevOps, "containers", 3);
        s.resolveBoss(DevOps, "containers", true);
        expect(() => s.resolveBoss(DevOps, "containers", true)).toThrow();
        masterN(s, DevOps, "containers", 3);
        expect(() => s.resolveBoss(DevOps, "containers", true)).not.toThrow();
    });

    it("a loss creates a bloodstain and floors the deduction (never de-levels)", () => {
        const s = new State();
        masterN(s, DevOps, "containers", 4); // logos 400, level 3 (threshold 300)
        const res = s.resolveBoss(DevOps, "containers", false);
        const disc = s.domains[DevOps].disciplines["containers"];
        expect(disc.bloodstain).not.toBeNull();
        expect(disc.bloodstain.amount).toBe(BossLoseLogos);
        expect(disc.logos).toBe(300); // 400 - 150 floored at threshold(3)=300 → actual -100
        expect(res.logosDelta).toBe(-100);
    });

    it("never de-levels at a level boundary", () => {
        const s = new State();
        masterN(s, DevOps, "containers", 3); // logos 300 exactly, level 3
        const before = levelForLogos(s.domains[DevOps].disciplines["containers"].logos);
        s.resolveBoss(DevOps, "containers", false);
        const disc = s.domains[DevOps].disciplines["containers"];
        expect(levelForLogos(disc.logos)).toBeGreaterThanOrEqual(before);
        expect(disc.logos).toBeGreaterThanOrEqual(thresholdForLevel(before));
    });

    it("recovering a bloodstain on the next win grants both", () => {
        const s = new State();
        masterN(s, DevOps, "containers", 4);
        s.resolveBoss(DevOps, "containers", false);
        const disc = s.domains[DevOps].disciplines["containers"];
        const logosAfterLoss = disc.logos; // 300
        masterN(s, DevOps, "containers", 3); // +300, unlocks next boss
        const res = s.resolveBoss(DevOps, "containers", true);
        expect(res.bloodstainRecovered).toBe(BossLoseLogos);
        expect(disc.logos).toBe(logosAfterLoss + 300 + BossLoseLogos + BossWinLogos);
        expect(disc.bloodstain).toBeNull();
    });

    it("a second consecutive loss forfeits the old bloodstain but drops a new one", () => {
        const s = new State();
        masterN(s, DevOps, "containers", 4);
        s.resolveBoss(DevOps, "containers", false);
        masterN(s, DevOps, "containers", 3);
        const res = s.resolveBoss(DevOps, "containers", false);
        expect(res.bloodstainRecovered).toBe(0);
        const disc = s.domains[DevOps].disciplines["containers"];
        expect(disc.bloodstain).not.toBeNull();
        expect(disc.bloodstain.amount).toBe(BossLoseLogos);
    });

    it("errors on an unknown discipline", () => {
        const s = new State();
        expect(() => s.resolveBoss(DevOps, "nonexistent", true)).toThrow();
    });
});

// ── open-quest cap ───────────────────────────────────────────────────────────

describe("open-quest cap", () => {
    it("allows the third distinct discipline, blocks the fourth", () => {
        const s = new State();
        s.recordQuestProgress(Networking, "dns", "q1", "Q1", true);
        s.recordQuestProgress(Sysadmin, "systemd", "q2", "Q2", true);
        s.recordQuestProgress(DevOps, "ci-cd", "q3", "Q3", true);
        let caught;
        try {
            s.recordQuestProgress(Networking, "security", "q4", "Q4", true);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ErrDisciplineLocked);
        expect(caught.openQuests.length).toBe(3);
        expect(s.disciplineExists(Networking, "security")).toBe(false);
    });

    it("mastering one frees a slot", () => {
        const s = new State();
        s.recordQuestProgress(Networking, "dns", "q1", "Q1", true);
        s.recordQuestProgress(Sysadmin, "systemd", "q2", "Q2", true);
        s.recordQuestProgress(DevOps, "ci-cd", "q3", "Q3", true);
        s.recordQuestProgress(Networking, "dns", "q1", "", true);
        s.recordQuestProgress(Networking, "dns", "q1", "", true); // q1 mastered
        expect(() => s.recordQuestProgress(Networking, "security", "q4", "Q4", true)).not.toThrow();
    });

    it("a title-rejected new quest leaves no discipline trace", () => {
        const s = new State();
        expect(() => s.recordQuestProgress(DevOps, "containers", "q1", "", true)).toThrow();
        expect(s.disciplineExists(DevOps, "containers")).toBe(false);
    });

    it("a started-but-not-mastered quest counts even after a wrong answer resets the streak", () => {
        const s = new State();
        s.recordQuestProgress(Networking, "dns", "q1", "Q1", true);  // streak 1
        s.recordQuestProgress(Networking, "dns", "q1", "", false);    // wrong → streak 0, still started
        s.recordQuestProgress(Sysadmin, "systemd", "q2", "Q2", true);
        s.recordQuestProgress(DevOps, "ci-cd", "q3", "Q3", true);
        // q1 sits at streak 0 but is started, so the cap is full: a 4th discipline is blocked.
        expect(s.openQuests().length).toBe(3);
        expect(() => s.recordQuestProgress(Networking, "security", "q4", "Q4", true)).toThrow(ErrDisciplineLocked);
    });

    it("a seeded quest that was only startQuest'd (never answered) does not occupy a slot", () => {
        const s = new State();
        s.startQuest(Networking, "dns", "seed1", "Seed 1");     // created, not answered
        s.startQuest(Sysadmin, "systemd", "seed2", "Seed 2");
        s.startQuest(DevOps, "ci-cd", "seed3", "Seed 3");
        expect(s.openQuests().length).toBe(0);
        // A brand-new discipline is still allowed — the seeds don't fill the cap.
        expect(() => s.recordQuestProgress(Networking, "security", "q1", "Q1", true)).not.toThrow();
    });
});
