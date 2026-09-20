import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedEvent } from "@bg/shared";
import { buildCodexCommand, runCodexTurn } from "../src/adapters/codex";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");

describe("buildCodexCommand", () => {
  test("uses Codex exec with JSON events and stdin prompt input", () => {
    expect(buildCodexCommand("/opt/homebrew/bin/codex")).toEqual([
      "/opt/homebrew/bin/codex",
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "-c", 'model_reasoning_effort="low"',
      "-c", "suppress_unstable_features_warning=true",
      "-c", "features.image_generation=true",
      "-",
    ]);
  });
});

describe("runCodexTurn image-tool liveness", () => {
  test("Given the silent built-in image tool saves a PNG mid-run When the file lands Then an image_generation call is surfaced before the stream ends and only once", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(tmpdir(), "burnguard-codex-image-"));
    const codexHome = path.join(root, "codex-home");
    const threadId = "01a0bd75-12bd-75a3-8193-127dd61ddb33";
    // Codex creates generated_images/ on install; the per-thread directory appears with the first image.
    await mkdir(path.join(codexHome, "generated_images"), { recursive: true });
    const goFile = path.join(root, "go");
    const binary = path.join(root, "codex-fixture");
    await writeFile(binary, [
      "#!/usr/bin/env bun",
      'import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs";',
      `const dir = ${JSON.stringify(path.join(codexHome, "generated_images", threadId))};`,
      `console.log(JSON.stringify({ type: "thread.started", thread_id: ${JSON.stringify(threadId)} }));`,
      "mkdirSync(dir, { recursive: true });",
      `writeFileSync(dir + "/exec-1.png", Buffer.from(${JSON.stringify(PNG.toString("base64"))}, "base64"));`,
      // Stay silent until the test has observed the live image call; then finish the turn.
      `await new Promise((resolve) => { const w = watch(${JSON.stringify(root)}, () => { if (existsSync(${JSON.stringify(goFile)})) { w.close(); resolve(); } }); if (existsSync(${JSON.stringify(goFile)})) { w.close(); resolve(); } });`,
      'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));',
      "",
    ].join("\n"));
    await chmod(binary, 0o700);
    const previousHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const events: NormalizedEvent[] = [];
    try {
      await runCodexTurn({
        sessionId: "codex-image-session",
        turnId: "codex-image-turn",
        projectDir: root,
        binaryPath: binary,
        prompt: "test",
        userEvent: { type: "user.message", text: "test" },
        onEvent: async (event) => {
          events.push(event);
          if (event.type === "tool.finished" && event.tool === "image_generation") await writeFile(goFile, "go");
        },
      });
    } finally {
      if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
      await rm(root, { recursive: true, force: true });
    }
    const types = events.map((event) => `${event.type}${"tool" in event ? ":" + event.tool : ""}`);
    const imageFinish = types.indexOf("tool.finished:image_generation");
    expect(imageFinish).toBeGreaterThan(-1);
    expect(imageFinish).toBeLessThan(types.indexOf("usage.delta"));
    expect(types.filter((type) => type === "tool.finished:image_generation")).toHaveLength(1);
    expect(events[imageFinish]).toMatchObject({ ok: true, output: { image_sha256: [PNG_SHA] } });
    expect(JSON.stringify(events)).not.toContain(codexHome);
    expect(events.at(-1)).toMatchObject({ type: "status.idle", stopReason: "end_turn" });
  });
});

describe("runCodexTurn interrupts", () => {
  test("Given an aborted codex turn When the run settles Then the owned child is gone and the turn reports interrupted", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(tmpdir(), "burnguard-codex-abort-"));
    const binary = path.join(root, "codex-fixture");
    const childScript = "await new Promise(() => {})";
    // Never exits by itself: only the abort teardown can end this run.
    await writeFile(binary, `#!/usr/bin/env bun\nconst child=Bun.spawn([process.execPath,"-e",${JSON.stringify(childScript)}],{stdin:"ignore",stdout:"ignore",stderr:"ignore"});child.unref();console.log(child.pid);\nawait new Promise(() => {});\n`);
    await chmod(binary, 0o700);
    const controller = new AbortController();
    const events: NormalizedEvent[] = [];
    let childPid = 0;
    try {
      await runCodexTurn({
        sessionId: "codex-abort-session",
        turnId: "codex-abort-turn",
        projectDir: root,
        binaryPath: binary,
        prompt: "test",
        userEvent: { type: "user.message", text: "test" },
        signal: controller.signal,
        onEvent: async (event) => {
          events.push(event);
          if (event.type === "chat.delta") { childPid = Number(event.text.trim()); controller.abort(); }
        },
      });
      expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
      expect(() => process.kill(childPid, 0)).toThrow();
      expect(events.at(-1)).toMatchObject({ type: "status.idle", stopReason: "interrupted" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
