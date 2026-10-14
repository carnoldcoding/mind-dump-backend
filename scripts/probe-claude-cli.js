// Probe the headless Claude Code call that Mind teaching turns use. Run it
// after a Claude Code update, or on a new box, to check the flags still work
// and the box is logged in. Reads Mind state for the context; writes nothing.
//
//   node scripts/probe-claude-cli.js
//
// Runs the exact flags and request a real turn uses (claudeArgs + turnRequest),
// with the output switched to stream-json so the process's own report is
// visible. Check three things in what it prints:
//   tools          only StructuredOutput — no Bash, files, or web
//   prompt tokens  6,266 against MindDump-dev on 2026-10-14 (grows slowly with
//                  the quest count). A sudden jump of a thousand or more means
//                  a CLAUDE.md or memory file is leaking into every turn: the
//                  global ~/.claude/CLAUDE.md alone is about 2,300 tokens
//   structured     the turn itself, in the shape TURN_SCHEMA describes

require("dotenv").config();
const childProcess = require("child_process");
const fs = require("fs");
const connectDB = require("../config/db");
const repo = require("../lib/mind/repository");
const { buildContext, turnRequest } = require("../lib/mind/broker");
const { claudeArgs, subscriptionEnv, DEFAULT_CWD } = require("../lib/mind/claudeCli");

async function main() {
    const bin = process.env.MIND_CLAUDE_BIN || "claude";
    console.log(`database: ${process.env.DB_NAME}   claude: ${bin}`);
    await connectDB();
    const { prompt, ...request } = turnRequest(await buildContext(repo, null), "What's due today? Keep it to two sentences.");

    const args = claudeArgs(request);
    args[args.indexOf("--output-format") + 1] = "stream-json";
    args.push("--verbose");
    fs.mkdirSync(DEFAULT_CWD, { recursive: true });
    const run = childProcess.spawnSync(bin, args, { input: prompt, cwd: DEFAULT_CWD, env: subscriptionEnv(process.env), encoding: "utf8", timeout: 180_000 });
    if (run.error) throw run.error;
    if (run.stderr) console.error(run.stderr.trim());

    const events = run.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const init = events.find((e) => e.type === "system" && e.subtype === "init") || {};
    const result = events.find((e) => e.type === "result") || {};
    const u = result.usage || {};
    const promptTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);

    console.log(`model:         ${init.model}`);
    console.log(`tools:         ${JSON.stringify(init.tools)}`);
    console.log(`mcp servers:   ${JSON.stringify(init.mcp_servers)}`);
    console.log(`prompt tokens: ${promptTokens}   (baseline 6,266 on 2026-10-14; see the header)`);
    console.log(`duration:      ${((result.duration_ms || 0) / 1000).toFixed(1)}s   exit ${run.status}   is_error ${result.is_error}`);
    console.log("structured:");
    console.log(JSON.stringify(result.structured_output ?? result.result, null, 2));
}

main().then(
    () => process.exit(0),
    (e) => { console.error(`probe failed: ${e.message}`); process.exit(1); },
);
