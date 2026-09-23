import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { mkdir, symlink } from "node:fs/promises";
import { buildCodexCommand } from "../src/adapters/codex";
import { codexFixture, PNG_SHA } from "./codex-runner-fixture";

const posixTest = (name: string, run: () => Promise<void>) => test.skipIf(process.platform === "win32")(name, run, 15_000);

function imageWatch(fixture: Awaited<ReturnType<typeof codexFixture>>) {
  const entry = [...fixture.watches].reverse().find((entry) => entry.path === fixture.imageRoot);
  if (!entry) throw new Error("image watcher not attached");
  return entry.watcher;
}

function parentWatch(fixture: Awaited<ReturnType<typeof codexFixture>>) {
  const entry = [...fixture.watches].reverse().find((entry) => entry.path === fixture.home);
  if (!entry) throw new Error("parent watcher not attached");
  return entry.watcher;
}

function expectGone(pids: readonly number[]) {
  expect(pids).toHaveLength(2);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
}

describe("buildCodexCommand", () => {
  test("uses Codex exec with JSON events and stdin prompt input", () => {
    expect(buildCodexCommand("/opt/homebrew/bin/codex")).toEqual([
      "/opt/homebrew/bin/codex", "exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write",
      "-c", 'model_reasoning_effort="low"', "-c", 'model_reasoning_summary="concise"',
      "-c", "suppress_unstable_features_warning=true",
      "-c", "features.image_generation=true", "-",
    ]);
  });
});

describe("runCodexTurn image-tool lifecycle (POSIX subprocess fixtures)", () => {
  for (const missingRoot of [false, true]) {
    posixTest(`Given generated_images is ${missingRoot ? "missing" : "present"} When a PNG lands after watcher attachment Then its hash is delivered live exactly once`, async () => {
      await using fixture = await codexFixture({ missingRoot });
      const imageFinished = Promise.withResolvers<void>();
      const run = fixture.start({ onEvent: async (event) => {
        if (event.type === "tool.finished") imageFinished.resolve();
      } });
      await fixture.ready;
      // The child is now silent, and attachment has already been attempted with no PNG present.
      expect(fixture.watches.map((entry) => entry.path)).toContain(missingRoot ? fixture.home : fixture.imageRoot);
      // Exercise parent-driven attachment before testing recursive file delivery. The controlled
      // null-name case below separately covers an image saved before attachment's initial sweep.
      const attached = fixture.imageAttached;
      if (missingRoot) await mkdir(fixture.imageRoot);
      await attached;
      const observed = Promise.race([imageFinished.promise, run.then(() => { throw new Error("image not delivered live"); })]);
      await fixture.image();
      await observed;
      await fixture.command("complete");
      expect(await run).toEqual({ exitCode: 0 });
      expect(fixture.controller.signal.aborted).toBe(false);
      expect(fixture.events.map((event) => event.type)).toEqual(["chat.delta", "tool.started", "tool.finished", "usage.delta", "chat.message_end", "status.idle"]);
      expect(fixture.events[2]).toMatchObject({ ok: true, output: { image_sha256: [PNG_SHA] } });
      expect(JSON.stringify(fixture.events)).not.toContain(fixture.home);
      expectGone(fixture.pids);
    });
  }

  posixTest("Given a silent owned child When a live callback rejects Then intake closes and settlement rejects with the same error without an external abort", async () => {
    await using fixture = await codexFixture();
    const failure = new Error("persistence_unavailable");
    const run = fixture.start({ onEvent: async (event) => {
      if (event.type === "tool.started") throw failure;
    } });
    await fixture.ready;
    await fixture.image();
    expect(await run).toBe(failure);
    expect(fixture.controller.signal.aborted).toBe(false);
    expect(fixture.events.map((event) => event.type)).toEqual(["chat.delta", "tool.started"]);
    expectGone(fixture.pids);
  });

  posixTest("Given a blocked stdout callback When a watcher scan and turn completion arrive Then parsing and callbacks preserve global delivery order", async () => {
    await using fixture = await codexFixture({ controlledWatch: true });
    const release = Promise.withResolvers<void>();
    const order: string[] = [];
    const run = fixture.start({ onEvent: async (event) => {
      if (event.type === "chat.delta") { order.push("chat.enter"); await release.promise; order.push("chat.exit"); }
      else order.push(event.type);
    } });
    try {
      await fixture.ready;
      await fixture.image();
      imageWatch(fixture).emit("change", "rename", null);
      // complete is buffered on stdout while the previous callback is still in flight.
      await fixture.command("complete");
      expect(order).toEqual(["chat.enter"]);
      release.resolve();
      expect(await run).toEqual({ exitCode: 0 });
      expect(order).toEqual(["chat.enter", "chat.exit", "tool.started", "tool.finished", "usage.delta", "chat.message_end", "status.idle"]);
      expect(fixture.events[2]).toMatchObject({ output: { image_sha256: [PNG_SHA] } });
    } finally { release.resolve(); }
  });

  posixTest("Given an in-flight image callback When stderr rejects Then owned cleanup closes intake and drains that callback before rejecting", async () => {
    await using fixture = await codexFixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failure = new Error("trace_unavailable");
    const run = fixture.start({
      onEvent: async (event) => { if (event.type === "tool.started") { entered.resolve(); await release.promise; } },
      onStderr: async () => { throw failure; },
    });
    try {
      await fixture.ready;
      const closed = once(imageWatch(fixture), "close", { signal: AbortSignal.timeout(5_000) });
      const observed = Promise.race([entered.promise, run.then(() => { throw new Error("image callback not entered"); })]);
      await fixture.image();
      await observed;
      await fixture.command("stderr");
      await closed;
      expect(fixture.settled).toBe(false);
      release.resolve();
      expect(await run).toBe(failure);
      expect(fixture.controller.signal.aborted).toBe(false);
      expect(fixture.events.map((event) => event.type)).toEqual(["chat.delta", "tool.started"]);
      expectGone(fixture.pids);
    } finally { release.resolve(); }
  });

  posixTest("Given a missing root When its parent reports a null filename Then attachment and the immediate hash sweep recover", async () => {
    await using fixture = await codexFixture({ missingRoot: true, controlledWatch: true });
    const finished = Promise.withResolvers<void>();
    const run = fixture.start({ onEvent: async (event) => { if (event.type === "tool.finished") finished.resolve(); } });
    await fixture.ready;
    await fixture.image();
    const observed = Promise.race([finished.promise, run.then(() => { throw new Error("null-name attachment failed"); })]);
    parentWatch(fixture).emit("change", "rename", null);
    await observed;
    await fixture.command("complete");
    expect(await run).toEqual({ exitCode: 0 });
    expect(fixture.events[2]).toMatchObject({ output: { image_sha256: [PNG_SHA] } });
  });

  posixTest("Given an attached image watcher When it reports an error Then a replacement delivers the next null-name notification live", async () => {
    await using fixture = await codexFixture({ controlledWatch: true });
    const finished = Promise.withResolvers<void>();
    const run = fixture.start({ onEvent: async (event) => { if (event.type === "tool.finished") finished.resolve(); } });
    await fixture.ready;
    const failed = imageWatch(fixture);
    failed.emit("error", new Error("watcher_lost"));
    expect(imageWatch(fixture)).not.toBe(failed);
    await fixture.image();
    const observed = Promise.race([finished.promise, run.then(() => { throw new Error("replacement watcher failed"); })]);
    imageWatch(fixture).emit("change", "rename", null);
    await observed;
    await fixture.command("complete");
    expect(await run).toEqual({ exitCode: 0 });
    expect(fixture.events.filter((event) => event.type === "tool.finished")).toHaveLength(1);
  });

  posixTest("Given a missing image root When the parent watcher errors Then its replacement attaches the newly created root", async () => {
    await using fixture = await codexFixture({ missingRoot: true, controlledWatch: true });
    const finished = Promise.withResolvers<void>();
    const run = fixture.start({ onEvent: async (event) => { if (event.type === "tool.finished") finished.resolve(); } });
    await fixture.ready;
    const failed = parentWatch(fixture);
    failed.emit("error", new Error("parent_watch_lost"));
    expect(parentWatch(fixture)).not.toBe(failed);
    await fixture.image();
    const observed = Promise.race([finished.promise, run.then(() => { throw new Error("parent recovery failed"); })]);
    parentWatch(fixture).emit("change", "rename", "generated_images");
    await observed;
    await fixture.command("complete");
    expect(await run).toEqual({ exitCode: 0 });
    expect(fixture.events[2]).toMatchObject({ output: { image_sha256: [PNG_SHA] } });
  });

  posixTest("Given a stdout event When its callback rejects Then the same error settles the owned process without synthetic completion", async () => {
    await using fixture = await codexFixture();
    const failure = new Error("stdout_persistence_unavailable");
    const run = fixture.start({ onEvent: async () => { throw failure; } });
    await fixture.ready;
    expect(await run).toBe(failure);
    expect(fixture.controller.signal.aborted).toBe(false);
    expect(fixture.events.map((event) => event.type)).toEqual(["chat.delta"]);
    expectGone(fixture.pids);
  });

  posixTest("Given a generated_images symlink escaping Codex home When the parent reports its creation Then neither observation nor hashing escapes the boundary", async () => {
    await using fixture = await codexFixture({ missingRoot: true, controlledWatch: true });
    const run = fixture.start();
    await fixture.ready;
    await symlink(fixture.root, fixture.imageRoot);
    parentWatch(fixture).emit("change", "rename", "generated_images");
    await fixture.command("complete");
    expect(await run).toEqual({ exitCode: 0 });
    expect(fixture.watches.every((entry) => entry.path === fixture.home)).toBe(true);
    expect(fixture.events.some((event) => event.type === "tool.started")).toBe(false);
  });

  posixTest("Given an owned child and descendant When the turn is aborted Then both are gone before interrupted settlement", async () => {
    await using fixture = await codexFixture();
    const run = fixture.start();
    await fixture.ready;
    fixture.controller.abort();
    await run;
    expectGone(fixture.pids);
    expect(fixture.events.at(-1)).toMatchObject({ type: "status.idle", stopReason: "interrupted" });
  });
});
