// Mind — the teaching broker (spec §2, §6, §7). Injects the teaching
// methodology, assembles context, calls Claude, and applies the
// structured-output actions through the service. This is the on-site teaching
// brain: the frontend never talks to Claude directly.
//
// Claude runs as headless Claude Code (`claude -p`, see claudeCli.js), billed to
// the Claude subscription. Until 2026-10-14 this called the Anthropic API with
// Sonnet 5 at low effort, a per-token cost decision; it taught too rigidly, and
// Opus over the API cost too much. Opus 5.5 through the subscription trades
// slower turns for better teaching. Spec: ~/specs/mind-dump-headless-broker.md.

const service = require("./service");
const { SYSTEM_PROMPT } = require("./methodology");
const { runClaude: defaultRunClaude } = require("./claudeCli");

const MODEL = "claude-opus-5-5";
const EFFORT = "medium"; // decided 2026-10-14

// Structured-output schema for one teaching turn (spec §6). `say` is the prose
// bubble; `actions` are the intended state changes the backend then applies.
const TURN_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["say", "actions"],
    properties: {
        say: { type: "string", description: "Conversational prose. On a grading turn, a brief ack only — never a predicted result." },
        // Optional. Present when this turn poses a multiple-choice diagnostic, so
        // the UI can render the options as clickable cards (spec §17). Omit for
        // open/free-text questions and Boss teach-backs.
        question: {
            type: "object",
            additionalProperties: false,
            // domain/discipline/quest name what this question tests, so the backend
            // can grade the click and record the answer itself (deterministic
            // grading — the model never scores an MC answer). correctId is which
            // option is right; it is stripped before the question reaches the UI.
            required: ["stem", "options", "correctId", "domain", "discipline", "quest"],
            properties: {
                stem: { type: "string", description: "The question text." },
                options: {
                    type: "array",
                    // NB: Anthropic structured output rejects minItems/maxItems > 1,
                    // so "exactly 4" is enforced by the prompt, not the schema.
                    description: "Exactly 4 equal-effort options. The app shuffles them and relabels the ids, so order here does not matter.",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "text"],
                        properties: { id: { type: "string" }, text: { type: "string" } },
                    },
                },
                correctId: { type: "string", description: "The id of the correct option, from options[].id." },
                domain: { type: "string", description: "networking | devops | sysadmin — the quest's domain." },
                discipline: { type: "string", description: "The quest's discipline slug." },
                quest: { type: "string", description: "The quest slug this question tests." },
            },
        },
        actions: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["op"],
                properties: {
                    op: { type: "string", enum: ["startQuest", "recordAnswer", "attemptBoss", "upsertLore", "linkQuests"] },
                    domain: { type: "string" },
                    discipline: { type: "string" },
                    quest: { type: "string" },
                    slug: { type: "string" },
                    title: { type: "string" },
                    correct: { type: "boolean" },
                    won: { type: "boolean" },
                    markdown: { type: "string" },
                    to: { type: "array", items: { type: "string" } },
                },
            },
        },
    },
};

const OPTION_IDS = "abcdefghijklmnopqrstuvwxyz".split("");

// Shuffle an MC question's options and relabel the ids a/b/c/d by final
// position, remapping `correctId` to wherever the correct option lands. Claude
// reliably emits the correct answer first; this decouples display order from the
// order it wrote, so the answer isn't always slot "a". Pure and deterministic
// given `rng` (defaults to Math.random) so it can be unit-tested. The remapped
// `correctId` is what the backend grades a click against; it is stripped from
// the question before it reaches the UI (see runTurn).
function prepareQuestion(question, rng = Math.random) {
    if (!question || !Array.isArray(question.options)) return question || null;
    const opts = question.options.slice();
    // Fisher–Yates.
    for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    let correctId = null;
    const options = opts.map((opt, i) => {
        const id = OPTION_IDS[i] ?? String(i + 1);
        if (opt.id === question.correctId) correctId = id;
        return { id, text: opt.text };
    });
    return { ...question, options, correctId };
}

// "nameserver-vs-resolver-terminology" → "Nameserver vs resolver terminology".
// Used as a fallback title so a first recordAnswer on a not-yet-created quest
// auto-creates it instead of failing with ErrTitleRequired mid-conversation.
function humanizeSlug(slug = "") {
    const s = slug.replace(/-/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Recover domain/discipline/quest from whatever shape Claude sent. The context
// uses composite ids ("domain/discipline/slug"), so Claude often echoes one into
// `quest` (or `id`) — split it, and let it override a hallucinated domain field.
// Also handle a composite discipline ("domain/discipline") for Boss actions.
function resolveRef(action) {
    let domain = action.domain;
    let discipline = action.discipline;
    let quest = action.quest || action.slug || action.id;
    if (quest && quest.split("/").length === 3) {
        const p = quest.split("/");
        [domain, discipline, quest] = [p[0], p[1], p[2]];
    }
    if (discipline && discipline.split("/").length === 2) {
        const p = discipline.split("/");
        [domain, discipline] = [p[0], p[1]];
    }
    return { domain, discipline, quest };
}

// Apply one action through the service. Returns the authoritative result the UI
// card renders. Kept separate so it can be unit-tested with an in-memory repo
// once wired (currently exercised indirectly by service.test.js).
async function applyAction(repo, action, sessionId, now = new Date()) {
    const ref = resolveRef(action);
    const base = { ...action, ...ref, title: action.title || humanizeSlug(ref.quest), sessionId, now };
    switch (action.op) {
        case "startQuest": return { op: action.op, ...(await service.startQuest(repo, base)) };
        case "recordAnswer": return { op: action.op, ...(await service.recordAnswer(repo, base)) };
        case "recordRecall": return { op: action.op, ...(await service.recordRecall(repo, base)) };
        case "attemptBoss": return { op: action.op, ...(await service.attemptBoss(repo, base)) };
        case "upsertLore": return { op: action.op, ...(await service.upsertLore(repo, base)) };
        case "linkQuests": return { op: action.op, ...(await service.linkQuests(repo, base)) };
        default: throw new Error(`unknown action op: ${action.op}`);
    }
}

// Ops the backend records itself when a multiple-choice click is graded (see
// `answer`). The model does not score these, so any it sends are dropped.
const BACKEND_GRADED_OPS = new Set(["recordAnswer", "recordRecall"]);

// Apply the model's actions in order; the backend result — not `say` — is
// authoritative. A single bad action (a domain-rule violation, a malformed
// field) must not sink the whole turn: capture it as an error result and keep
// the conversation alive, rather than 4xx-ing and showing "couldn't reach".
async function applyModelActions(repo, actions, sessionId, now = new Date()) {
    const results = [];
    for (const action of actions || []) {
        if (BACKEND_GRADED_OPS.has(action.op)) continue;
        try {
            results.push(await applyAction(repo, action, sessionId, now));
        } catch (e) {
            console.error(`[mind] action ${action.op} failed:`, e.code || e.message);
            results.push({ op: action.op, error: e.code || e.message });
        }
    }
    return results;
}

// The message that hands a graded click back to the model to teach on. It says
// what the click counted as and, after a recall, exactly which recalls are
// still due — so "recalls are done" comes from state, not the model's memory.
function followUpMessage({ stem, chosenText, rightText, correct, kind, due = [] }) {
    const parts = [
        `The learner answered the multiple-choice question "${stem}" with "${chosenText}". ` +
        `That is ${correct ? "CORRECT" : "INCORRECT"}. The correct answer is "${rightText}".`,
    ];
    if (kind === "recall") {
        parts.push(`This was a RECALL of a mastered quest, and the app recorded it as ${correct ? "PASSED" : "FAILED"}.`);
        parts.push(due.length
            ? `Recalls still due: ${due.length} — ${due.map((q) => `${q.title} (${q.domain}/${q.discipline}/${q.slug})`).join("; ")}.`
            : "No recalls remain due. Tell the learner their recalls are done.");
    } else if (kind === "practice") {
        parts.push("This quest is mastered and not due for recall, so the answer was not recorded and counts toward nothing.");
    }
    parts.push(
        "Teach on this: explain the mechanical why; for a wrong answer, contrast their choice with the correct one. " +
        "Do NOT restate the streak, recall tier, score, or mastery — the app shows those. Then continue the lesson."
    );
    return parts.join(" ");
}

// Assemble the per-turn context: current state summary + due recalls + a recent
// transcript window (spec §7.1). Kept small; the stable system prompt is cached.
async function buildContext(repo, session) {
    const [quests, discs, due] = await Promise.all([
        repo.allQuests(),
        repo.allDisciplines(),
        service.dueRecalls(repo, new Date()),
    ]);
    // Trimmed to what a turn actually needs: disciplines, what's due, the quests
    // currently in a streak (detailed), and a compact roster of everything else
    // (id + state only) so Claude knows what exists without re-sending every
    // field each turn. Transcript capped short — the system prompt is cached.
    // Give Claude the exact fields actions take (domain, discipline, quest=slug)
    // rather than only composite ids, so it copies them straight into actions.
    return {
        disciplines: discs.map((d) => ({ domain: d.domain, discipline: d.slug, logos: d.logos, sinceBoss: d.questsSinceBoss, bloodstain: d.bloodstain?.amount ?? null })),
        due: due.map((q) => ({ domain: q.domain, discipline: q.discipline, quest: q.slug, title: q.title, tier: q.recallTier })),
        open: quests.filter((q) => q.streak > 0 && !q.mastered).map((q) => ({ domain: q.domain, discipline: q.discipline, quest: q.slug, title: q.title, streak: q.streak })),
        known: quests.map((q) => ({ domain: q.domain, discipline: q.discipline, quest: q.slug, m: q.mastered, p: q.prestiged })),
        recentTranscript: (session?.transcript || []).slice(-8),
    };
}

// Run one model turn: assemble context, call Claude, apply its actions, persist
// the transcript, and stash any newly-posed MC question's answer key on the
// session. Shared by the free-text messages path (`teach`) and the graded-answer
// path (`answer`). `transcriptUser` is what gets written to the transcript as the
// learner's turn, which differs from `userMessage` on the answer path (there the
// model is told the grade, but the transcript records the plain answer).
//
// recordAnswer and recordRecall actions are DROPPED here on purpose: MC answers
// and recalls are graded and recorded by the backend (see `answer`), so the
// model never scores one. Boss stays model-judged and its action still applies.
async function runTurn(repo, { sessionId, userMessage, transcriptUser }, { runClaude = defaultRunClaude } = {}) {
    const session = sessionId ? await repo.getSession(sessionId) : null;
    const context = await buildContext(repo, session);

    // NOTE: non-streaming. Spec §7.1 wants the prose streamed; that is a
    // refinement, not a correctness issue.
    const { structured: turn, usage: u, durationMs } = await runClaude({
        model: MODEL,
        effort: EFFORT,
        system: SYSTEM_PROMPT,
        schema: TURN_SCHEMA,
        prompt: `CURRENT STATE:\n${JSON.stringify(context)}\n\nLEARNER:\n${userMessage}`,
    });

    // Per-turn log. Subscription turns aren't billed per token, so no dollar
    // figure; tokens and time are what's worth watching.
    console.log(`[mind] turn: in=${u.input_tokens || 0} out=${u.output_tokens || 0} cacheRead=${u.cache_read_input_tokens || 0} duration=${(durationMs / 1000).toFixed(1)}s`);

    const now = new Date();
    const results = await applyModelActions(repo, turn.actions, sessionId, now);

    // Shuffle any posed MC question and stash its answer key on the session; the
    // UI is only ever sent { stem, options }. A turn with no question clears the
    // key, so a stale question can't be answered against.
    let question = null;
    if (turn.question) {
        const p = prepareQuestion(turn.question);
        question = { stem: p.stem, options: p.options };
        if (sessionId) {
            await repo.setPendingQuestion(sessionId, {
                correctId: p.correctId, domain: p.domain, discipline: p.discipline,
                quest: p.quest, title: p.title || null, stem: p.stem, options: p.options,
            });
        }
    } else if (sessionId) {
        await repo.setPendingQuestion(sessionId, null);
    }

    if (sessionId) {
        await repo.appendTranscript(sessionId, [
            { role: "user", content: transcriptUser ?? userMessage, t: now },
            { role: "assistant", content: turn.say, t: now },
        ]);
    }

    return { say: turn.say, question, results };
}

// Sessions with a turn running. A turn now takes tens of seconds, so a
// double-click would otherwise start a second Claude process on the same
// session. Single-user app: this is about duplicates, not load.
const busy = new Set();

async function oneTurnAtATime(sessionId, fn) {
    if (!sessionId) return fn();
    if (busy.has(sessionId)) {
        const e = new Error("a turn is already running for this session");
        e.code = "turn_in_progress";
        throw e;
    }
    busy.add(sessionId);
    try {
        return await fn();
    } finally {
        busy.delete(sessionId);
    }
}

// The free-text messages endpoint: one teaching turn from a learner message
// (open questions, Recall/Boss teach-backs, "explain more", the opener).
// `deps` lets tests replace the Claude call.
async function teach(repo, { sessionId, userMessage }, deps) {
    return oneTurnAtATime(sessionId, () => runTurn(repo, { sessionId, userMessage }, deps));
}

// The MC-answer endpoint: grade the learner's click deterministically against
// the stored answer key, record it as a mastery answer, a recall, or nothing
// (practice) according to the Quest's state, then have the model teach on the
// graded result without scoring it.
async function answer(repo, args, deps) {
    return oneTurnAtATime(args.sessionId, () => gradeAndTeach(repo, args, deps));
}

async function gradeAndTeach(repo, { sessionId, optionId }, deps) {
    const session = sessionId ? await repo.getSession(sessionId) : null;
    const pending = session && session.pendingQuestion;
    if (!pending) {
        const e = new Error("no question is awaiting an answer");
        e.code = "no_pending_question";
        throw e;
    }

    const now = new Date();
    const correct = optionId === pending.correctId;
    const base = {
        domain: pending.domain, discipline: pending.discipline, quest: pending.quest,
        title: pending.title || humanizeSlug(pending.quest),
        correct, sessionId, now,
    };
    const outcome = await service.gradeAnswer(repo, base);
    // Clear the key first so a double-submit can't grade the same question twice.
    await repo.setPendingQuestion(sessionId, null);

    // Now let the model teach on the graded result — it explains, it does not score.
    const chosen = (pending.options || []).find((o) => o.id === optionId);
    const right = (pending.options || []).find((o) => o.id === pending.correctId);
    const chosenText = chosen ? chosen.text : optionId;
    const due = outcome.kind === "recall" ? await service.dueRecalls(repo, now) : [];
    const teachMsg = followUpMessage({
        stem: pending.stem,
        chosenText,
        rightText: right ? right.text : pending.correctId,
        correct,
        kind: outcome.kind,
        due,
    });

    const t = await runTurn(repo, {
        sessionId,
        userMessage: teachMsg,
        transcriptUser: `${optionId}. ${chosenText}`,
    }, deps);
    // The authoritative outcome leads the results; the model's teach turn follows.
    return { say: t.say, question: t.question, results: [outcome, ...t.results] };
}

module.exports = { teach, answer, applyAction, applyModelActions, followUpMessage, buildContext, prepareQuestion, TURN_SCHEMA, MODEL, EFFORT };
