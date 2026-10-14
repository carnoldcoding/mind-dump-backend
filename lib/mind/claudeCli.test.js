// Mind — claudeCli tests: the headless `claude -p` call, with spawn stubbed.
// Covers the argument list, the prompt going in on stdin, result parsing, and
// how each failure maps to an error code the controller turns into a status.
// describe/it/expect are Vitest globals (vitest.config.js: globals: true).

const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { runClaude } = require("./claudeCli");

// A fake child process. `finish` writes stdout/stderr and closes with `code`;
// leaving it unset simulates a process that never exits (the timeout case).
function fakeSpawn({ stdout = "", stderr = "", code = 0, hang = false } = {}) {
    const calls = [];
    const spawn = (bin, args, opts) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdin = new PassThrough();
        let stdin = "";
        child.stdin.on("data", (d) => { stdin += d; });
        child.killed = false;
        child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", null, "SIGTERM")); };
        calls.push({ bin, args, opts, child, stdin: () => stdin });
        if (!hang) {
            setImmediate(() => {
                child.stdout.end(stdout);
                child.stderr.end(stderr);
                child.emit("close", code, null);
            });
        }
        return child;
    };
    return { spawn, calls };
}

const result = (over = {}) => JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "{\"say\":\"hi\"}",
    structured_output: { say: "hi", actions: [] },
    duration_ms: 2688,
    usage: { input_tokens: 2, output_tokens: 143, cache_read_input_tokens: 900, cache_creation_input_tokens: 1138 },
    ...over,
});

const call = { model: "claude-opus-5-5", effort: "medium", system: "SYS", schema: { type: "object" }, prompt: "LEARNER: hello" };

describe("runClaude", () => {
    it("passes the model, effort, prompt, schema, and lockdown flags as an argument array", async () => {
        const { spawn, calls } = fakeSpawn({ stdout: result() });
        await runClaude(call, { spawn, bin: "/opt/claude", cwd: "/tmp/x" });
        const { bin, args, opts } = calls[0];
        expect(bin).toBe("/opt/claude");
        expect(opts.cwd).toBe("/tmp/x");
        expect(opts.shell).toBeFalsy();
        const flag = (name) => args[args.indexOf(name) + 1];
        expect(args[0]).toBe("-p");
        expect(flag("--model")).toBe("claude-opus-5-5");
        expect(flag("--effort")).toBe("medium");
        expect(flag("--system-prompt")).toBe("SYS");
        expect(JSON.parse(flag("--json-schema"))).toEqual({ type: "object" });
        expect(flag("--output-format")).toBe("json");
        expect(flag("--tools")).toBe("");
        expect(flag("--setting-sources")).toBe("");
        expect(args).toContain("--strict-mcp-config");
        expect(args).toContain("--no-session-persistence");
    });

    it("strips API-key auth from the child's environment so the subscription login is used", async () => {
        const { spawn, calls } = fakeSpawn({ stdout: result() });
        const env = { HOME: "/home/x", PATH: "/bin", ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_WORKSPACE_ID: "w" };
        await runClaude(call, { spawn, env });
        expect(calls[0].opts.env).toEqual({ HOME: "/home/x", PATH: "/bin" });
    });

    it("sends the prompt on stdin, never as an argument", async () => {
        const { spawn, calls } = fakeSpawn({ stdout: result() });
        await runClaude({ ...call, prompt: "--dangerously-skip-permissions" }, { spawn });
        expect(calls[0].stdin()).toBe("--dangerously-skip-permissions");
        expect(calls[0].args).not.toContain("--dangerously-skip-permissions");
    });

    it("returns the structured output, usage, and duration", async () => {
        const { spawn } = fakeSpawn({ stdout: result() });
        const out = await runClaude(call, { spawn });
        expect(out.structured).toEqual({ say: "hi", actions: [] });
        expect(out.usage.output_tokens).toBe(143);
        expect(out.durationMs).toBe(2688);
    });

    it("fails with claude_failed on a non-zero exit and no result", async () => {
        const { spawn } = fakeSpawn({ stdout: "", stderr: "boom", code: 1 });
        await expect(runClaude(call, { spawn })).rejects.toMatchObject({ code: "claude_failed" });
    });

    it("fails with claude_failed on output that isn't JSON", async () => {
        const { spawn } = fakeSpawn({ stdout: "not json" });
        await expect(runClaude(call, { spawn })).rejects.toMatchObject({ code: "claude_failed" });
    });

    it("fails with claude_failed when the result has no structured output", async () => {
        const { spawn } = fakeSpawn({ stdout: result({ structured_output: undefined }) });
        await expect(runClaude(call, { spawn })).rejects.toMatchObject({ code: "claude_failed" });
    });

    it("fails with claude_limit and passes Claude Code's own message through", async () => {
        const msg = "You've hit your limit · resets 3pm (America/Chicago)";
        const { spawn } = fakeSpawn({ stdout: result({ is_error: true, result: msg, api_error_status: 429 }), code: 1 });
        await expect(runClaude(call, { spawn })).rejects.toMatchObject({ code: "claude_limit", message: expect.stringContaining("resets 3pm") });
    });

    it("fails with claude_auth when the host isn't logged in", async () => {
        const { spawn } = fakeSpawn({ stdout: result({ is_error: true, result: "Not logged in · Please run /login" }), code: 1 });
        await expect(runClaude(call, { spawn })).rejects.toMatchObject({ code: "claude_auth" });
    });

    it("fails with claude_failed on any other error result", async () => {
        const { spawn } = fakeSpawn({ stdout: result({ is_error: true, result: "API Error: 500" }), code: 1 });
        await expect(runClaude(call, { spawn })).rejects.toMatchObject({ code: "claude_failed" });
    });

    it("kills the process and fails with claude_timeout when it runs too long", async () => {
        const { spawn, calls } = fakeSpawn({ hang: true });
        await expect(runClaude(call, { spawn, timeoutMs: 10 })).rejects.toMatchObject({ code: "claude_timeout" });
        expect(calls[0].child.killed).toBe(true);
    });

    it("fails with claude_failed when the binary can't be started", async () => {
        const spawn = () => {
            const child = new EventEmitter();
            child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
            child.kill = () => {};
            setImmediate(() => child.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })));
            return child;
        };
        await expect(runClaude(call, { spawn })).rejects.toMatchObject({ code: "claude_failed" });
    });
});
