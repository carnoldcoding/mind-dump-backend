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
// Model: claude-opus-4-8 (spec §7.1). Billed per-token to a SEPARATE Anthropic
// API account — not the $20/mo subscription.

const service = require("./service");
const { SYSTEM_PROMPT } = require("./methodology");

const MODEL = "claude-opus-4-8";

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
            required: ["stem", "options"],
            properties: {
                stem: { type: "string", description: "The question text." },
                options: {
                    type: "array",
                    description: "2–4 equal-effort options; randomize which is correct.",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "text"],
                        properties: { id: { type: "string" }, text: { type: "string" } },
                    },
                },
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

// Apply one action through the service. Returns the authoritative result the UI
// card renders. Kept separate so it can be unit-tested with an in-memory repo
// once wired (currently exercised indirectly by service.test.js).
async function applyAction(repo, action, sessionId, now = new Date()) {
    const base = { ...action, quest: action.quest || action.slug, sessionId, now };
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
    return {
        due,
        disciplines: discs.map((d) => ({ id: d._id, logos: d.logos, questsSinceBoss: d.questsSinceBoss, bloodstain: d.bloodstain?.amount ?? null })),
        quests: quests.map((q) => ({ id: q._id, title: q.title, streak: q.streak, mastered: q.mastered, recallTier: q.recallTier, prestiged: q.prestiged })),
        recentTranscript: (session?.transcript || []).slice(-12),
    };
}

// Run one teaching turn. SHELVED — the Anthropic call is written to the
// claude-api skill's guidance but unverified.
async function teach(repo, { sessionId, userMessage }) {
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
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: TURN_SCHEMA } },
        messages: [
            { role: "user", content: `CURRENT STATE:\n${JSON.stringify(context)}\n\nLEARNER:\n${userMessage}` },
        ],
    });

    // Parse the structured payload.
    const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
    const turn = JSON.parse(text);

    // Apply actions in order; the backend result — not `say` — is authoritative.
    const now = new Date();
    const results = [];
    for (const action of turn.actions || []) {
        results.push(await applyAction(repo, action, sessionId, now));
    }

    if (sessionId) {
        await repo.appendTranscript(sessionId, [
            { role: "user", content: userMessage, t: now },
            { role: "assistant", content: turn.say, t: now },
        ]);
    }

    return { say: turn.say, question: turn.question || null, results };
}

module.exports = { teach, applyAction, buildContext, TURN_SCHEMA, MODEL };
