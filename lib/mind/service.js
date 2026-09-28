// Mind — the service layer. Orchestrates one teaching action: load the State
// from the repository, apply the domain transition, build the event(s), persist
// the projection, append the events, and return the authoritative post-apply
// view for the UI result card (spec §2, §6).
//
// The repository is injected (see repository.js for the Mongo implementation,
// and service.test.js for the in-memory one), so this whole flow — including
// event generation — is testable without Mongo.

const { levelForLogos } = require("./leveling");
const { BossEvery } = require("./constants");
const events = require("./events");

// ── authoritative views for the UI (never Claude's prose) ───────────────────

function questView(state, { domain, discipline, quest }) {
    const q = state.domains[domain]?.disciplines[discipline]?.quests[quest];
    if (!q) return null;
    return {
        domain, discipline, slug: q.slug, title: q.title,
        streak: q.streak, mastered: q.mastered, masteredAt: q.masteredAt,
        recallTier: q.recallTier, nextRecallDue: q.nextRecallDue, prestiged: q.prestiged,
    };
}

function disciplineView(state, domain, discipline) {
    const disc = state.domains[domain]?.disciplines[discipline];
    if (!disc) return null;
    return {
        domain, slug: disc.slug, title: disc.title,
        logos: disc.logos, level: levelForLogos(disc.logos),
        questsSinceBoss: disc.questsSinceBoss,
        bloodstain: disc.bloodstain ? disc.bloodstain.amount : null,
        bossAvailable: disc.questsSinceBoss >= BossEvery,
    };
}

// ── actions ─────────────────────────────────────────────────────────────────

async function recordAnswer(repo, input) {
    const now = input.now || new Date();
    const state = await repo.loadState();
    const outcome = state.recordQuestProgress(
        input.domain, input.discipline, input.quest, input.title || "", input.correct, now
    );
    const evs = events.progressEvents(input, outcome, now);
    await repo.saveState(state);
    await repo.appendEvents(evs);
    return {
        outcome,
        quest: questView(state, input),
        discipline: disciplineView(state, input.domain, input.discipline),
        events: evs,
    };
}

async function recordRecall(repo, input) {
    const now = input.now || new Date();
    const state = await repo.loadState();
    const outcome = state.recordRecall(input.domain, input.discipline, input.quest, input.correct, now);
    const evs = events.recallEvents(input, outcome, now);
    await repo.saveState(state);
    await repo.appendEvents(evs);
    return {
        outcome,
        quest: questView(state, input),
        discipline: disciplineView(state, input.domain, input.discipline),
        events: evs,
    };
}

// Record one graded multiple-choice click. What it counts as is read from the
// Quest's state, never from the model: a mastered Quest whose recall is due is
// a recall, a mastered Quest that isn't due (or is prestiged) is practice and
// records nothing, and anything else is a mastery answer. Recalls used to be
// recorded only if the model remembered to send recordRecall afterwards, and
// every click went through recordAnswer — a no-op on a mastered Quest.
async function gradeAnswer(repo, input) {
    const now = input.now || new Date();
    const state = await repo.loadState();
    const q = state.domains[input.domain]?.disciplines[input.discipline]?.quests[input.quest];

    if (q && q.mastered) {
        const due = !q.prestiged && q.nextRecallDue && now.getTime() >= new Date(q.nextRecallDue).getTime();
        if (!due) {
            return { op: "practice", kind: "practice", correct: input.correct, quest: questView(state, input), events: [] };
        }
        return { op: "recordRecall", kind: "recall", correct: input.correct, ...(await recordRecall(repo, { ...input, now })) };
    }
    return { op: "recordAnswer", kind: "mastery", correct: input.correct, ...(await recordAnswer(repo, { ...input, now })) };
}

async function attemptBoss(repo, input) {
    const now = input.now || new Date();
    const state = await repo.loadState();
    const result = state.resolveBoss(input.domain, input.discipline, input.won);
    const evs = events.bossEvents(input, result, now);
    await repo.saveState(state);
    await repo.appendEvents(evs);
    return {
        result,
        discipline: disciplineView(state, input.domain, input.discipline),
        events: evs,
    };
}

async function startQuest(repo, input) {
    const now = input.now || new Date();
    const state = await repo.loadState();
    const outcome = state.startQuest(input.domain, input.discipline, input.quest, input.title || "");
    const evs = outcome.created ? events.startQuestEvent(input, now) : [];
    await repo.saveState(state);
    if (evs.length) await repo.appendEvents(evs);
    return {
        outcome,
        quest: questView(state, input),
        discipline: disciplineView(state, input.domain, input.discipline),
        events: evs,
    };
}

async function upsertLore(repo, input) {
    const now = input.now || new Date();
    const state = await repo.loadState();
    const q = state.domains[input.domain]?.disciplines[input.discipline]?.quests[input.quest];
    if (!q) throw new (require("./errors").ErrQuestNotFound)(input.domain, input.discipline, input.quest);
    q.lore = input.markdown;
    await repo.saveState(state);
    const evs = events.loreEditEvent(input, now);
    await repo.appendEvents(evs);
    return { quest: questView(state, input), events: evs };
}

async function linkQuests(repo, input) {
    const now = input.now || new Date();
    const state = await repo.loadState();
    const q = state.domains[input.domain]?.disciplines[input.discipline]?.quests[input.quest];
    if (!q) throw new (require("./errors").ErrQuestNotFound)(input.domain, input.discipline, input.quest);
    const added = (input.to || []).filter((t) => !q.links.includes(t));
    q.links.push(...added);
    await repo.saveState(state);
    const evs = added.length ? events.linkEditEvent({ ...input, added }, now) : [];
    if (evs.length) await repo.appendEvents(evs);
    return { quest: questView(state, input), events: evs };
}

// ── reads ────────────────────────────────────────────────────────────────────

async function dueRecalls(repo, now = new Date()) {
    const state = await repo.loadState();
    return state.dueRecalls(now).map((ref) => questView(state, ref));
}

module.exports = { recordAnswer, recordRecall, gradeAnswer, attemptBoss, startQuest, upsertLore, linkQuests, dueRecalls, questView, disciplineView };
