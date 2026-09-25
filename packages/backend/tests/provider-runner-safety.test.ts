import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { NormalizedEvent } from "@bg/shared";
import { runCliTurn } from "../src/adapters/cli-turn";
import { parseGeminiLine } from "../src/adapters/gemini/parser";
import { parseCopilotLine } from "../src/adapters/copilot/parser";

const ctx = { turnId: "safety-turn" };
test("Given CLI metadata, prompt echoes and failures, then only assistant content reaches chat", () => {
  for (const parse of [parseGeminiLine, parseCopilotLine]) {
    for (const line of ['{"type":"message","role":"user","content":"PRIVATE_PROMPT"}', '{"token":"PRIVATE"}', '{broken "PRIVATE"}', 'Error: PRIVATE', 'PRIVATE diagnostic']) expect(parse(line, ctx)).toEqual([]);
  }
  expect(parseGeminiLine('{"type":"message","role":"assistant","content":"hello"}', ctx)).toMatchObject([{ type: "chat.delta", text: "hello" }]);
  expect(parseGeminiLine('{"type":"result","status":"error"}', ctx)).toMatchObject([{ type: "status.idle", stopReason: "error" }]);
  expect(parseGeminiLine('{"type":"error","severity":"error","message":"PRIVATE"}', ctx)).toMatchObject([{ type: "status.idle", stopReason: "error" }]);
  expect(parseCopilotLine('{"type":"session.error","data":{"message":"PRIVATE"}}', ctx)).toMatchObject([{ type: "status.idle", stopReason: "error" }]);
});

test("Given a long multilingual task, then argv stays short, UTF-8 input is exact, cleanup precedes completion", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-cli-safety-"));
  const prompt = "PRIVATE 한국어 🧪\n".repeat(8000);
  const digest = createHash("sha256").update(prompt).digest("hex");
  const events: NormalizedEvent[] = [];
  let unsubscribed = false;
  const script = `import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto';
    const arg=process.argv.at(-1); if(arg.length>1000)process.exit(2);
    const file=/Read (\\S+) as UTF-8/.exec(arg)?.[1];
    if(!file || createHash('sha256').update(readFileSync(file)).digest('hex')!==${JSON.stringify(digest)})process.exit(3);
    console.log(JSON.stringify({type:'result',status:'error'}));
    console.log(JSON.stringify({type:'message',role:'assistant',content:'finished reading'}));`;
  try {
    const result = await runCliTurn({ sessionId: "safety", turnId: ctx.turnId, projectDir: root, binaryPath: process.execPath, prompt,
      userEvent: { type: "user.message", text: "test" },
      onDecision: () => () => { unsubscribed = true; },
      onEvent: async event => {
        if (event.type === "status.idle") expect(await readdir(path.join(root, ".burnguard-inputs"))).toEqual([]);
        events.push(event);
      },
    }, { provider: "fixture", cmd: [process.execPath, "-e", script, prompt], stdinPrompt: null, parse: line => parseGeminiLine(line, ctx) });
    expect(result.exitCode).toBe(0);
    expect(unsubscribed).toBe(true);
    expect(events).toMatchObject([{ type: "chat.delta", text: "finished reading" }, { type: "chat.message_end", turnId: ctx.turnId }, { type: "status.idle", stopReason: "error" }]);
    expect(JSON.stringify(events)).not.toContain("PRIVATE");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);

test("Given a Gemini-shaped CLI that exits 0 with a success result When the turn settles Then the events end with chat.message_end for the turn followed by status.idle end_turn", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-cli-success-"));
  const events: NormalizedEvent[] = [];
  const script = `console.log(JSON.stringify({type:'message',role:'assistant',content:'done'}));console.log(JSON.stringify({type:'result',status:'success'}));`;
  try {
    const result = await runCliTurn({ sessionId: "safety", turnId: ctx.turnId, projectDir: root, binaryPath: process.execPath, prompt: "task",
      userEvent: { type: "user.message", text: "task" }, onEvent: async event => { events.push(event); },
    }, { provider: "fixture", cmd: [process.execPath, "-e", script], stdinPrompt: "task", parse: line => parseGeminiLine(line, ctx) });
    expect(result.exitCode).toBe(0);
    expect(events).toMatchObject([{ type: "chat.delta", text: "done" }, { type: "chat.message_end", turnId: ctx.turnId }, { type: "status.idle", stopReason: "end_turn" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a CLI that writes more than 2 MiB of short assistant lines and a consumer that stalls on its first event When the turn settles Then it resolves with exit 0 and delivers every line", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-cli-burst-"));
  const lines = 40_000;
  const drained = Promise.withResolvers<void>();
  let deltas = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("fixture drain deadline")), 15_000); });
  // The child reports on stderr once every stdout byte has left it, so the first event is held until the whole burst is buffered.
  const script = `const line=JSON.stringify({type:'message',role:'assistant',content:'x'.repeat(80)})+'\\n';process.stdout.write(line.repeat(${lines}),()=>console.error('DRAINED'));`;
  try {
    const result = await runCliTurn({ sessionId: "safety", turnId: ctx.turnId, projectDir: root, binaryPath: process.execPath, prompt: "task",
      userEvent: { type: "user.message", text: "task" },
      onEvent: async event => { if (event.type === "chat.delta" && deltas++ === 0) await Promise.race([drained.promise, deadline]); },
      onStderr: async line => { if (line === "DRAINED") drained.resolve(); },
    }, { provider: "fixture", cmd: [process.execPath, "-e", script], stdinPrompt: "task", parse: line => parseGeminiLine(line, ctx) });
    expect(result.exitCode).toBe(0);
    expect(deltas).toBe(lines);
  } finally { clearTimeout(timer); await rm(root, { recursive: true, force: true }); }
}, 20_000);

test("Given a single unterminated line over 2 MiB When the turn reads it Then provider_stream_limit is still thrown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-cli-limit-"));
  try {
    await expect(runCliTurn({ sessionId: "safety", turnId: ctx.turnId, projectDir: root, binaryPath: process.execPath, prompt: "task",
      userEvent: { type: "user.message", text: "task" }, onEvent: async () => {},
    }, { provider: "fixture", cmd: [process.execPath, "-e", `process.stdout.write('x'.repeat(${2 * 1024 * 1024 + 1}))`], stdinPrompt: "task", parse: line => parseGeminiLine(line, ctx) })).rejects.toThrow("provider_stream_limit");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);

test("Given a short line then a newline-terminated line over 2 MiB and a consumer that stalls on its first event When the turn reads it Then provider_stream_limit is thrown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-cli-long-line-"));
  const drained = Promise.withResolvers<void>();
  let first = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("fixture drain deadline")), 15_000); });
  // Holding the first event until the child has flushed everything makes the oversized line arrive terminated inside one coalesced chunk.
  const script = `const a=JSON.stringify({type:'message',role:'assistant',content:'hi'})+'\\n';const b=JSON.stringify({type:'message',role:'assistant',content:'y'.repeat(${2 * 1024 * 1024 + 1})})+'\\n';process.stdout.write(a+b,()=>console.error('DRAINED'));`;
  try {
    await expect(runCliTurn({ sessionId: "safety", turnId: ctx.turnId, projectDir: root, binaryPath: process.execPath, prompt: "task",
      userEvent: { type: "user.message", text: "task" },
      onEvent: async event => { if (event.type === "chat.delta" && first) { first = false; await Promise.race([drained.promise, deadline]); } },
      onStderr: async line => { if (line === "DRAINED") drained.resolve(); },
    }, { provider: "fixture", cmd: [process.execPath, "-e", script], stdinPrompt: "task", parse: line => parseGeminiLine(line, ctx) })).rejects.toThrow("provider_stream_limit");
  } finally { clearTimeout(timer); await rm(root, { recursive: true, force: true }); }
}, 20_000);

test("Given spawn failure, then the decision subscription and private task are released", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-cli-failure-"));
  let unsubscribed = false;
  try {
    await expect(runCliTurn({ sessionId: "safety", turnId: ctx.turnId, projectDir: root, binaryPath: "/missing/cli", prompt: "PRIVATE",
      userEvent: { type: "user.message", text: "test" }, onDecision: () => () => { unsubscribed = true; }, onEvent: async () => {},
    }, { provider: "fixture", cmd: [path.join(root, "absent.exe"), "PRIVATE"], stdinPrompt: null, parse: line => parseGeminiLine(line, ctx) })).rejects.toThrow();
    expect(unsubscribed).toBe(true);
    expect(await readdir(path.join(root, ".burnguard-inputs"))).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
