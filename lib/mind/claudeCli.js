// Mind — one teaching turn through headless Claude Code (`claude -p`), billed to
// the Claude subscription instead of per-token API usage. Spec:
// ~/specs/mind-dump-headless-broker.md §4.
//
// Each call starts a fresh process with no Claude Code session: Mongo holds the
// conversation, and the broker sends the context every turn. The process gets
// no tools, no MCP servers, no settings files, and writes no session to disk.
// The prompt goes in on stdin so learner text can never be read as a flag, and
// spawn gets an argument array, never a shell.

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

// Turns can run long on Opus; nginx's /api/mind/ read timeout sits above this.
const TIMEOUT_MS = 180_000;
const KILL_GRACE_MS = 5_000;

// An empty working directory, so Claude Code finds no project CLAUDE.md.
const DEFAULT_CWD = path.join(__dirname, "..", "..", ".claude-cwd");

// Claude Code prefers these over the subscription login when they're set, and
// the backend's .env may still carry an old API key. Left in, every turn would
// bill per token to the API account instead of the subscription.
const API_AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_WORKSPACE_ID"];

function subscriptionEnv(env) {
    const out = { ...env };
    for (const name of API_AUTH_VARS) delete out[name];
    return out;
}

function fail(code, message) {
    return Object.assign(new Error(message), { code });
}

// Map an error result from Claude Code to one of our codes. Its message is
// kept: on a usage limit it already says when the limit resets.
function classify(res) {
    const text = String(res.result || res.subtype || "unknown error");
    if (res.api_error_status === 429 || /usage limit|hit your limit|rate limit/i.test(text)) {
        return fail("claude_limit", `Claude usage limit reached: ${text}`);
    }
    if (res.api_error_status === 401 || /not logged in|\/login|invalid api key|authenticat/i.test(text)) {
        return fail("claude_auth", text);
    }
    return fail("claude_failed", text);
}

// The flags for one turn. Exported so the probe script runs exactly these.
function claudeArgs({ model, effort, system, schema }) {
    return [
        "-p",
        "--model", model,
        "--effort", effort,
        "--system-prompt", system,
        "--json-schema", JSON.stringify(schema),
        "--output-format", "json",
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--no-session-persistence",
    ];
}

function runClaude({ prompt, ...request }, opts = {}) {
    const {
        spawn = childProcess.spawn,
        bin = process.env.MIND_CLAUDE_BIN || "claude",
        cwd = DEFAULT_CWD,
        timeoutMs = TIMEOUT_MS,
        killGraceMs = KILL_GRACE_MS,
        env = process.env,
    } = opts;
    if (cwd === DEFAULT_CWD) fs.mkdirSync(cwd, { recursive: true });

    return new Promise((resolve, reject) => {
        const child = spawn(bin, claudeArgs(request), { cwd, env: subscriptionEnv(env), stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const settle = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };
        const failWith = (err) => {
            if (stderr) console.error("[mind] claude stderr:", stderr.trim());
            settle(reject, err);
        };

        // SIGTERM first; SIGKILL if it's still running after the grace period, so
        // a stuck process can't outlive the turn guard that already let go.
        const timer = setTimeout(() => {
            let exited = false;
            child.on("close", () => { exited = true; });
            child.kill("SIGTERM");
            setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, killGraceMs).unref();
            failWith(fail("claude_timeout", `Claude didn't answer within ${Math.round(timeoutMs / 1000)} seconds`));
        }, timeoutMs);

        child.stdout.on("data", (d) => { stdout += d; });
        child.stderr.on("data", (d) => { stderr += d; });
        // A process that dies before reading its prompt breaks the pipe (EPIPE).
        // Unhandled, that error would take down the whole server; "close" still
        // fires and reports the failure.
        child.stdin.on("error", () => {});
        child.on("error", (e) => failWith(fail("claude_failed", `couldn't start Claude Code (${bin}): ${e.message}`)));
        child.on("close", (code) => {
            let res;
            try {
                res = JSON.parse(stdout);
            } catch {
                return failWith(fail("claude_failed", `Claude Code exited ${code} without a result`));
            }
            if (res.is_error) return failWith(classify(res));
            if (code !== 0) return failWith(fail("claude_failed", `Claude Code exited ${code}`));
            if (!res.structured_output || typeof res.structured_output !== "object") {
                return failWith(fail("claude_failed", "Claude Code returned no structured output"));
            }
            settle(resolve, { structured: res.structured_output, usage: res.usage || {}, durationMs: res.duration_ms || 0 });
        });

        child.stdin.end(prompt);
    });
}

module.exports = { runClaude, claudeArgs, subscriptionEnv, DEFAULT_CWD };
