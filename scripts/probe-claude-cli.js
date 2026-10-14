// Probe the headless Claude Code call that Mind teaching turns use. Run it
// after a Claude Code update, or on a new host, to check the flags still work
// and the host is logged in. Reads Mind state for the context; writes nothing.
//
//   node scripts/probe-claude-cli.js
//
// Prints the turn Claude returned, its token use and time, and the tools the
// process had (should be only StructuredOutput: no Bash, files, or web).

require("dotenv").config();
const connectDB = require("../config/db");
const repo = require("../lib/mind/repository");
const { buildContext, TURN_SCHEMA, MODEL, EFFORT } = require("../lib/mind/broker");
const { SYSTEM_PROMPT } = require("../lib/mind/methodology");
const { runClaude } = require("../lib/mind/claudeCli");

async function main() {
    console.log(`database: ${process.env.DB_NAME}   claude: ${process.env.MIND_CLAUDE_BIN || "claude (from PATH)"}`);
    await connectDB();
    const context = await buildContext(repo, null);
    const out = await runClaude({
        model: MODEL,
        effort: EFFORT,
        system: SYSTEM_PROMPT,
        schema: TURN_SCHEMA,
        prompt: `CURRENT STATE:\n${JSON.stringify(context)}\n\nLEARNER:\nWhat's due today? Keep it to two sentences.`,
    });
    console.log(JSON.stringify(out.structured, null, 2));
    console.log(`in=${out.usage.input_tokens} out=${out.usage.output_tokens} cacheRead=${out.usage.cache_read_input_tokens} duration=${(out.durationMs / 1000).toFixed(1)}s`);
}

main().then(
    () => process.exit(0),
    (e) => { console.error(`probe failed: ${e.code || ""} ${e.message}`); process.exit(1); },
);
