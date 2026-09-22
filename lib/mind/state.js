// Mind — the in-memory game state and its transitions, ported from Grimoire's
// state.go / review.go (→ recall) / boss.go. This is the single source of
// truth for game logic; it has no knowledge of Mongo or HTTP. The repository
// layer materialises a State from the projection collections, applies a
// transition, then persists the changed docs and appends events.
//
// Structure mirrors Grimoire: Domains → Disciplines → Quests. A Quest here is
// the unified node (spec §3): it also carries `lore` and `links`, but the game
// logic below never touches those — Lore/edges are handled by the API layer.

const C = require("./constants");
const { levelForLogos, thresholdForLevel, averageLevel } = require("./leveling");
const E = require("./errors");

function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function newQuest(slug, title) {
    return {
        slug,
        title,
        streak: 0,
        mastered: false,
        masteredAt: null,
        // recallTier indexes RecallLadderDays; meaningless until mastered,
        // frozen once prestiged. -1 until mastery seeds it (matches Grimoire).
        recallTier: -1,
        nextRecallDue: null,
        prestiged: false,
        // Set true on the first recorded answer. Distinguishes a Quest actually
        // being worked from a seeded-but-untouched one, so the open-quest cap
        // counts only started work — and survives a streak reset (a wrong answer)
        // where `streak > 0` would not. See openQuests().
        started: false,
        // Unified-node facets (spec §3) — untouched by game logic.
        lore: null,
        links: [],
    };
}

function newDiscipline(slug) {
    return { slug, title: "", quests: {}, logos: 0, questsSinceBoss: 0, bloodstain: null };
}

// addLogos applies a Logos delta to a Discipline. Negative deltas (Boss
// losses) are floored at the threshold of the Discipline's level as it stood
// before the delta, so a loss can never de-level — only strip progress toward
// the next level.
function addLogos(disc, delta) {
    if (delta >= 0) {
        disc.logos += delta;
        return;
    }
    const floor = thresholdForLevel(levelForLogos(disc.logos));
    disc.logos += delta;
    if (disc.logos < floor) disc.logos = floor;
}

class State {
    constructor() {
        this.domains = {};
        for (const slug of Object.keys(C.ValidDomains)) {
            this.domains[slug] = { slug, disciplines: {} };
        }
    }

    disciplineExists(domainSlug, disciplineSlug) {
        const d = this.domains[domainSlug];
        return !!(d && d.disciplines[disciplineSlug]);
    }

    // Every started-but-not-mastered Quest across the whole state. A seeded Quest
    // that has never been answered (started === false) does not occupy a slot, so
    // the open-quest cap tracks active work rather than the whole curriculum.
    openQuests() {
        const open = [];
        for (const [domainSlug, d] of Object.entries(this.domains)) {
            for (const [discSlug, disc] of Object.entries(d.disciplines)) {
                for (const [questSlug, q] of Object.entries(disc.quests)) {
                    if (q.started && !q.mastered) open.push({ domain: domainSlug, discipline: discSlug, quest: questSlug });
                }
            }
        }
        return open;
    }

    // Log one diagnostic answer against a Quest, creating Domain/Discipline/
    // Quest as needed. Creating a brand-new Discipline is blocked by
    // ErrDisciplineLocked when the open-quest cap is met; depth is never
    // blocked. Returns a ProgressOutcome.
    recordQuestProgress(domainSlug, disciplineSlug, questSlug, title, correct, now = new Date()) {
        if (!C.ValidDomains[domainSlug]) throw new E.ErrInvalidDomain(domainSlug);
        const d = this.domains[domainSlug];

        let disc = d.disciplines[disciplineSlug];
        const discExisted = !!disc;
        if (!disc) {
            if (this.openQuests().length >= C.OpenQuestCap) {
                throw new E.ErrDisciplineLocked(this.openQuests());
            }
            disc = newDiscipline(disciplineSlug);
            d.disciplines[disciplineSlug] = disc;
        }

        let q = disc.quests[questSlug];
        const questExisted = !!q;
        if (!q) {
            if (!title) {
                // Roll back an empty Discipline we may have just created, so a
                // rejected call leaves no trace.
                if (!discExisted && Object.keys(disc.quests).length === 0) {
                    delete d.disciplines[disciplineSlug];
                }
                throw new E.ErrTitleRequired(domainSlug, disciplineSlug, questSlug);
            }
            q = newQuest(questSlug, title);
            disc.quests[questSlug] = q;
        }

        const out = {
            created: !questExisted,
            mastered: false,
            streak: 0,
            logosAwarded: 0,
            disciplineLevelBefore: 0,
            disciplineLevelAfter: 0,
            bossAvailable: false,
        };
        const levelBefore = levelForLogos(disc.logos);

        if (q.mastered) {
            // No-op scoring against an already-mastered quest.
            out.streak = q.streak;
            out.mastered = true;
            out.disciplineLevelBefore = levelBefore;
            out.disciplineLevelAfter = levelBefore;
            return out;
        }

        q.started = true; // any recorded answer marks the Quest as worked
        q.streak = correct ? q.streak + 1 : 0;
        out.streak = q.streak;

        if (q.streak >= C.MasteryStreak) {
            q.mastered = true;
            addLogos(disc, C.QuestLogos);
            out.mastered = true;
            out.logosAwarded = C.QuestLogos;

            q.masteredAt = now;
            q.recallTier = 0;
            q.nextRecallDue = addDays(now, C.RecallLadderDays[0]);

            disc.questsSinceBoss++;
            if (disc.questsSinceBoss >= C.BossEvery) out.bossAvailable = true;
        }

        out.disciplineLevelBefore = levelBefore;
        out.disciplineLevelAfter = levelForLogos(disc.logos);
        return out;
    }

    // Create an un-started Quest without recording an answer (the web's
    // explicit "startQuest" action — Grimoire only ever created lazily on the
    // first progress call). Cap and title guards match recordQuestProgress; an
    // already-existing Quest is a no-op.
    startQuest(domainSlug, disciplineSlug, questSlug, title) {
        if (!C.ValidDomains[domainSlug]) throw new E.ErrInvalidDomain(domainSlug);
        const d = this.domains[domainSlug];

        let disc = d.disciplines[disciplineSlug];
        const discExisted = !!disc;
        if (!disc) {
            if (this.openQuests().length >= C.OpenQuestCap) throw new E.ErrDisciplineLocked(this.openQuests());
            disc = newDiscipline(disciplineSlug);
            d.disciplines[disciplineSlug] = disc;
        }

        if (disc.quests[questSlug]) return { created: false };
        if (!title) {
            if (!discExisted && Object.keys(disc.quests).length === 0) delete d.disciplines[disciplineSlug];
            throw new E.ErrTitleRequired(domainSlug, disciplineSlug, questSlug);
        }
        disc.quests[questSlug] = newQuest(questSlug, title);
        return { created: true };
    }

    questTitle(ref) {
        const q = this.domains[ref.domain]?.disciplines[ref.discipline]?.quests[ref.quest];
        return q ? q.title : ref.quest;
    }

    disciplineLevel(domainSlug, disciplineSlug) {
        const disc = this.domains[domainSlug]?.disciplines[disciplineSlug];
        return disc ? levelForLogos(disc.logos) : 1;
    }

    domainLevel(domainSlug) {
        const d = this.domains[domainSlug];
        if (!d) return 1;
        const levels = Object.values(d.disciplines).map((disc) => levelForLogos(disc.logos));
        return averageLevel(levels);
    }

    characterLevel() {
        const slugs = Object.keys(C.ValidDomains);
        const sum = slugs.reduce((acc, slug) => acc + this.domainLevel(slug), 0);
        return sum / slugs.length;
    }

    // Log one recall (spaced-repetition) result against a mastered Quest. A
    // pass advances one tier; passing the final tier Prestiges (exits the
    // ladder, no Logos). A fail demotes one tier (never below 0).
    recordRecall(domainSlug, disciplineSlug, questSlug, correct, now = new Date()) {
        if (!C.ValidDomains[domainSlug]) throw new E.ErrInvalidDomain(domainSlug);
        const disc = this.domains[domainSlug]?.disciplines[disciplineSlug];
        if (!disc) throw new E.ErrQuestNotFound(domainSlug, disciplineSlug, questSlug);
        const q = disc.quests[questSlug];
        if (!q) throw new E.ErrQuestNotFound(domainSlug, disciplineSlug, questSlug);
        if (!q.mastered) throw new E.ErrQuestNotMastered(domainSlug, disciplineSlug, questSlug);
        if (q.prestiged) throw new E.ErrQuestPrestiged(domainSlug, disciplineSlug, questSlug);

        const out = { passed: false, prestiged: false, tierBefore: q.recallTier, tierAfter: q.recallTier, nextRecallDue: null };

        if (correct) {
            if (q.recallTier === C.RecallLadderDays.length - 1) {
                q.prestiged = true;
                q.nextRecallDue = null;
                out.passed = true;
                out.prestiged = true;
                out.tierAfter = q.recallTier;
                return out;
            }
            q.recallTier++;
            out.passed = true;
        } else {
            if (q.recallTier > 0) q.recallTier--;
            out.passed = false;
        }

        q.nextRecallDue = addDays(now, C.RecallLadderDays[q.recallTier]);
        out.tierAfter = q.recallTier;
        out.nextRecallDue = q.nextRecallDue;
        return out;
    }

    // Every mastered, not-prestiged Quest whose next recall is due at or
    // before `now`.
    dueRecalls(now = new Date()) {
        const due = [];
        for (const [domainSlug, d] of Object.entries(this.domains)) {
            for (const [discSlug, disc] of Object.entries(d.disciplines)) {
                for (const [questSlug, q] of Object.entries(disc.quests)) {
                    if (!q.mastered || q.prestiged) continue;
                    if (q.nextRecallDue && now.getTime() >= q.nextRecallDue.getTime()) {
                        due.push({ domain: domainSlug, discipline: discSlug, quest: questSlug });
                    }
                }
            }
        }
        return due;
    }

    // Resolve a Boss Phase attempt. Available once BossEvery Quests have been
    // mastered since it last resolved; re-locks after every attempt. A win
    // awards BossWinLogos plus any outstanding Bloodstain (recoverable once);
    // a loss deducts BossLoseLogos (floored, never de-levels) and drops a
    // fresh Bloodstain, forfeiting any prior one.
    resolveBoss(domainSlug, disciplineSlug, win) {
        if (!C.ValidDomains[domainSlug]) throw new E.ErrInvalidDomain(domainSlug);
        const disc = this.domains[domainSlug]?.disciplines[disciplineSlug];
        if (!disc) throw new E.ErrDisciplineNotFound(domainSlug, disciplineSlug);
        if (disc.questsSinceBoss < C.BossEvery) {
            throw new E.ErrBossNotAvailable(domainSlug, disciplineSlug, disc.questsSinceBoss);
        }

        const levelBefore = levelForLogos(disc.logos);
        const logosBefore = disc.logos;
        const res = {
            win,
            logosDelta: 0,
            bloodstainRecovered: 0,
            disciplineLevelBefore: levelBefore,
            disciplineLevelAfter: levelBefore,
        };

        if (win) {
            let gain = C.BossWinLogos;
            if (disc.bloodstain) {
                res.bloodstainRecovered = disc.bloodstain.amount;
                gain += disc.bloodstain.amount;
                disc.bloodstain = null;
            }
            addLogos(disc, gain);
        } else {
            addLogos(disc, -C.BossLoseLogos);
            // The bloodstain holds the nominal loss regardless of flooring, and
            // always replaces any prior one (per-death, not per-boss).
            disc.bloodstain = { amount: C.BossLoseLogos };
        }

        disc.questsSinceBoss = 0;
        res.logosDelta = disc.logos - logosBefore;
        res.disciplineLevelAfter = levelForLogos(disc.logos);
        return res;
    }
}

module.exports = { State, addDays, newQuest, newDiscipline };
