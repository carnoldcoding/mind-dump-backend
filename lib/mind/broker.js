// Mind — the Claude API broker (spec §2, §6, §7). Holds the API key, injects
// the teaching methodology, assembles context, calls Claude, and applies the
// structured-output actions through the service. This is the on-site teaching
// brain: the frontend never talks to Claude directly.
//
// SHELVED until an Anthropic API account + key exist, and needs `npm i
// @anthropic-ai/sdk`. Nothing here has been run. The action dispatcher and
// context assembly are structural; the model call and the prompt will want
// tuning against real sessions (see the handoff's shelf list).
//
// Model: claude-sonnet-5 (cost decision 2026-09-20). Teaching is chat-shaped,
// not reasoning-hard, so thinking is OFF and effort is low — extended thinking
// bills at the output rate and was the bulk of the cost on Opus. The system
// prompt is cached; per-turn context is trimmed. Billed per-token to a SEPARATE
// Anthropic API account — not the $20/mo subscription.

const service = require("./service");
const { SYSTEM_PROMPT } = require("./methodology");

const MODEL = "claude-sonnet-5";

// Sonnet 5 rates ($/M tokens), for the per-turn cost log below.
const RATE = { in: 2, cacheRead: 0.2, cacheWrite: 2.5, out: 10 };

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
                    op: { type: "string", enum: ["startQuest", "recordAnswer", "recordRecall", "attemptBoss", "upsertLore", "linkQuests"] },
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
// recordAnswer actions are DROPPED here on purpose: MC answers are graded and
// recorded by the backend (see `answer`), so the model never scores one. Recall
// and Boss stay model-judged and their actions still apply.
async function runTurn(repo, { sessionId, userMessage, transcriptUser }) {
    const Anthropic = require("@anthropic-ai/sdk"); // requires: npm i @anthropic-ai/sdk
    // Reads ANTHROPIC_API_KEY. An org-scoped key also needs the workspace id as
    // a header; a workspace-scoped key does not, so it's sent only when set.
    const client = new Anthropic(
        process.env.ANTHROPIC_WORKSPACE_ID
            ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
            : undefined
    );

    const session = sessionId ? await repo.getSession(sessionId) : null;
    const context = await buildContext(repo, session);

    // NOTE: non-streaming first cut. Spec §7.1 wants the prose streamed; that is
    // a refinement once the turn shape is confirmed against real sessions.
    const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        // Teaching is chat-shaped: thinking off, low effort. Both cut cost hard
        // (thinking bills at the output rate). Structured output still applies.
        thinking: { type: "disabled" },
        // System prompt cached: it's the stable prefix, re-billed full price every
        // turn otherwise. Cached reads are ~1/10 the input rate.
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        output_config: { effort: "low", format: { type: "json_schema", schema: TURN_SCHEMA } },
        messages: [
            { role: "user", content: `CURRENT STATE:\n${JSON.stringify(context)}\n\nLEARNER:\n${userMessage}` },
        ],
    });

    // Per-turn cost log, so spend is measured, not guessed.
    const u = res.usage || {};
    const inTok = u.input_tokens || 0, outTok = u.output_tokens || 0;
    const cRead = u.cache_read_input_tokens || 0, cWrite = u.cache_creation_input_tokens || 0;
    const cost = (inTok * RATE.in + outTok * RATE.out + cRead * RATE.cacheRead + cWrite * RATE.cacheWrite) / 1e6;
    console.log(`[mind] turn: in=${inTok} out=${outTok} cacheRead=${cRead} cacheWrite=${cWrite} → $${cost.toFixed(4)}`);

    // Parse the structured payload.
    const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
    const turn = JSON.parse(text);

    // Apply actions in order; the backend result — not `say` — is authoritative.
    // A single bad action (a domain-rule violation, a malformed field) must not
    // sink the whole turn: capture it as an error result and keep the
    // conversation alive, rather than 4xx-ing and showing "couldn't reach".
    const now = new Date();
    const results = [];
    for (const action of turn.actions || []) {
        if (action.op === "recordAnswer") continue; // backend grades MC, not the model
        try {
            results.push(await applyAction(repo, action, sessionId, now));
        } catch (e) {
            console.error(`[mind] action ${action.op} failed:`, e.code || e.message);
            results.push({ op: action.op, error: e.code || e.message });
        }
    }

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

// The free-text messages endpoint: one teaching turn from a learner message
// (open questions, Recall/Boss teach-backs, "explain more", the opener).
async function teach(repo, { sessionId, userMessage }) {
    return runTurn(repo, { sessionId, userMessage });
}

// The MC-answer endpoint: grade the learner's click deterministically against
// the stored answer key, record it (authoritative — one event, correct streak
// reset), then have the model teach on the graded result without scoring it.
async function answer(repo, { sessionId, optionId }) {
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
    const outcome = { op: "recordAnswer", ...(await service.recordAnswer(repo, base)) };
    // Clear the key first so a double-submit can't grade the same question twice.
    await repo.setPendingQuestion(sessionId, null);

    // Now let the model teach on the graded result — it explains, it does not score.
    const chosen = (pending.options || []).find((o) => o.id === optionId);
    const right = (pending.options || []).find((o) => o.id === pending.correctId);
    const chosenText = chosen ? chosen.text : optionId;
    const teachMsg =
        `The learner answered the multiple-choice question "${pending.stem}" with "${chosenText}". ` +
        `That is ${correct ? "CORRECT" : "INCORRECT"}. The correct answer is "${right ? right.text : pending.correctId}". ` +
        `Teach on this: explain the mechanical why; for a wrong answer, contrast their choice with the correct one. ` +
        `Do NOT restate the streak, score, or mastery — the app shows those. Then continue the lesson.`;

    const t = await runTurn(repo, {
        sessionId,
        userMessage: teachMsg,
        transcriptUser: `${optionId}. ${chosenText}`,
    });
    // The authoritative outcome leads the results; the model's teach turn follows.
    return { say: t.say, question: t.question, results: [outcome, ...t.results] };
}

module.exports = { teach, answer, applyAction, buildContext, prepareQuestion, TURN_SCHEMA, MODEL };
