import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedEvent } from "@bg/shared";
import { buildCodexCommand, runCodexTurn } from "../src/adapters/codex";

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
      "-",
    ]);
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
