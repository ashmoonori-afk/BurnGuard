import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedEvent } from "@bg/shared";
import { buildCodexCommand, codexSpawnOptions, runCodexTurn } from "../src/adapters/codex";
import { CODEX_PROGRESS_HEADER, codexProgressHandler, countStreamEvents } from "../src/adapters/codex/progress-metrics";
import { codexProgressMetricsEffective, detectUserCodexOtel, resolveCodexProgressMetrics } from "../src/adapters/codex/user-otel";
import { codexFixture, PNG_SHA } from "./codex-runner-fixture";

// Every case runs on every OS: on Windows the fixture is a .cmd wrapper launched through BG_WINDOWS_PROCESS_HOST.
const runnerTest = (name: string, run: () => Promise<void>) => test(name, run, 30_000);

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

  test("Given a progress receiver Then Codex exports its metrics there with a space-free, double-quote-free override and the run token", () => {
    const command = buildCodexCommand("codex", undefined, "win32", "allowed", { endpoint: "http://127.0.0.1:4100/v1/metrics", token: "abc123" });
    const override = command.find((arg) => arg.startsWith("otel.metrics_exporter="));
    expect(command[command.indexOf(override ?? "") - 1]).toBe("-c");
    expect(override).toBe(`otel.metrics_exporter={otlp-http={endpoint='http://127.0.0.1:4100/v1/metrics',protocol='json',headers={${CODEX_PROGRESS_HEADER}='abc123'}}}`);
    expect(override).not.toContain('"');
    expect(command.at(-1)).toBe("-");
  });
});

/** OTLP/JSON delta sum as Codex exports it for its per-stream-event counters. */
function metricsExport(name: string, points: readonly { readonly success: string; readonly value: number | string }[]) {
  return { resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name, sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: points.map((point) => ({
    attributes: [{ key: "kind", value: { stringValue: "response.custom_tool_call_input.delta" } }, { key: "success", value: { stringValue: point.success } }],
    asInt: point.value,
  })) } }] }] }] };
}

function exportRequest(body: unknown, token: string, url = "http://127.0.0.1/v1/metrics") {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", [CODEX_PROGRESS_HEADER]: token }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("Codex stream progress metrics", () => {
  test("Given websocket or SSE stream event counters Then only successful events are counted", () => {
    expect(countStreamEvents(metricsExport("codex.websocket.event", [{ success: "true", value: "3" }, { success: "false", value: "9" }]))).toBe(3);
    expect(countStreamEvents(metricsExport("codex.sse_event", [{ success: "true", value: 2 }]))).toBe(2);
    expect(countStreamEvents(metricsExport("codex.api_request", [{ success: "true", value: 5 }]))).toBe(0);
    expect(countStreamEvents(metricsExport("codex.sse_event", [{ success: "true", value: 0 }]))).toBe(0);
    expect(countStreamEvents({ resourceMetrics: "not-a-list" })).toBe(0);
  });

  test("Given an authenticated export with stream events When it arrives Then it is progress and Codex gets an empty OTLP reply", async () => {
    let beats = 0;
    const handle = codexProgressHandler("token", () => { beats++; });
    const response = await handle(exportRequest(metricsExport("codex.websocket.event", [{ success: "true", value: "1" }]), "token"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(beats).toBe(1);
  });

  test("Given exports that prove nothing When they arrive Then none of them is progress", async () => {
    let beats = 0;
    const handle = codexProgressHandler("token", () => { beats++; });
    const events = metricsExport("codex.sse_event", [{ success: "true", value: 4 }]);
    expect((await handle(exportRequest(events, "tokem"))).status).toBe(404);
    expect((await handle(exportRequest(events, "token", "http://127.0.0.1/v1/logs"))).status).toBe(404);
    expect((await handle(exportRequest("{", "token"))).status).toBe(400);
    expect((await handle(exportRequest(metricsExport("codex.sse_event", [{ success: "false", value: 4 }]), "token"))).status).toBe(200);
    expect((await handle(exportRequest(metricsExport("codex.api_request", [{ success: "true", value: 1 }]), "token"))).status).toBe(200);
    expect(beats).toBe(0);
  });

  /**
   * Runs a Codex stand-in that tries to export one stream event wherever its argv points, then
   * reports what it saw: the export status, the OTel interval, every OTel argument and OTEL_* name, and
   * whether the endpoint and token survived argv (on Windows it passes through a .cmd wrapper).
   */
  async function runMetricsFixture(codexProgressMetrics: boolean | undefined) {
    const root = await mkdtemp(path.join(tmpdir(), "burnguard-codex-progress-"));
    const previousHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(root, "codex-home");
    const script = path.join(root, process.platform === "win32" ? "codex-fixture.mjs" : "codex-fixture");
    await writeFile(script, [
      "#!/usr/bin/env bun",
      'const override = process.argv.find((arg) => arg.startsWith("otel.metrics_exporter=")) ?? "";',
      "const endpoint = /endpoint='([^']+)'/.exec(override)?.[1];",
      `const token = /${CODEX_PROGRESS_HEADER}='([^']+)'/.exec(override)?.[1];`,
      `const body = ${JSON.stringify(JSON.stringify(metricsExport("codex.websocket.event", [{ success: "true", value: "2" }])))};`,
      `const status = endpoint && token ? (await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "${CODEX_PROGRESS_HEADER}": token }, body })).status : 0;`,
      'const otelArgs = process.argv.filter((arg) => arg.includes("otel"));',
      'const otelEnv = Object.keys(process.env).filter((name) => name.startsWith("OTEL_")).sort();',
      'console.log(JSON.stringify({ type: "text", text: JSON.stringify({ status, interval: process.env.OTEL_METRIC_EXPORT_INTERVAL ?? null, otelArgs: otelArgs.length, otelEnv, parsed: { endpoint: Boolean(endpoint), token: Boolean(token) } }) }));',
      'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));',
      "",
    ].join("\n"));
    let binary = script;
    if (process.platform === "win32") {
      binary = path.join(root, "codex-fixture.cmd");
      await writeFile(binary, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    } else await chmod(script, 0o700);
    const order: string[] = [];
    const events: NormalizedEvent[] = [];
    try {
      const result = await runCodexTurn({
        sessionId: "s", turnId: "t", projectDir: root, binaryPath: binary, prompt: "test", userEvent: { type: "user.message", text: "test" },
        ...(codexProgressMetrics === undefined ? {} : { codexProgressMetrics }),
        onEvent: async (event) => { events.push(event); order.push(event.type); },
        onProgress: () => { order.push("progress"); },
      });
      const report = events.find((event) => event.type === "chat.delta");
      return { result, order, events, report: report?.type === "chat.delta" ? JSON.parse(report.text) : undefined };
    } finally {
      if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }

  const parentOtelEnv = () => Object.keys(process.env).filter((name) => name.startsWith("OTEL_")).sort();

  test("Given the setting off When the spawn is prepared Then argv and options are exactly the plain launch with no env override", () => {
    const input = { sessionId: "s", turnId: "t", projectDir: "/project", binaryPath: "codex", prompt: "p", userEvent: { type: "user.message", text: "p" } as const, generation: { model: "gpt-5", effort: "medium", vanilla: true } as const, onEvent: async () => {} };
    const options = codexSpawnOptions(input, undefined);
    expect(Object.keys(options).sort()).toEqual(["cmd", "cwd", "stderr", "stdin", "stdout"]);
    expect(options.cmd).toEqual(buildCodexCommand("codex", input.generation, process.platform, "allowed"));
    expect(options.cmd.some((arg) => arg.includes("otel"))).toBe(false);
    expect(options).toMatchObject({ cwd: "/project", stdout: "pipe", stderr: "pipe" });
    const on = codexSpawnOptions(input, { endpoint: "http://127.0.0.1:4100/v1/metrics", token: "abc" });
    expect(on.cmd.filter((arg) => arg.includes("otel"))).toHaveLength(1);
    expect("env" in on && on.env?.OTEL_METRIC_EXPORT_INTERVAL).toBe("10000");
  });

  runnerTest("Given the setting off (absent or false) and a progress sink When the turn runs Then Codex gets no OTel override or env and no receiver is reachable", async () => {
    for (const setting of [undefined, false]) {
      const { result, order, report } = await runMetricsFixture(setting);
      expect(result).toEqual({ exitCode: 0 });
      expect(report).toEqual({ status: 0, interval: process.env.OTEL_METRIC_EXPORT_INTERVAL ?? null, otelArgs: 0, otelEnv: parentOtelEnv(), parsed: { endpoint: false, token: false } });
      expect(order).not.toContain("progress");
    }
  });

  runnerTest("Given the setting on and a Codex child that exports a stream event When the turn runs Then progress arrives through the run's loopback receiver and nothing about it is published", async () => {
    const { result, order, events, report } = await runMetricsFixture(true);
    expect(result).toEqual({ exitCode: 0 });
    expect(report).toMatchObject({ status: 200, interval: "10000", otelArgs: 1, parsed: { endpoint: true, token: true } });
    expect(order).toEqual(["progress", "chat.delta", "usage.delta", "chat.message_end", "status.idle"]);
    expect(JSON.stringify(events)).not.toContain("/v1/metrics");
  });
});

describe("user Codex OpenTelemetry destination detection", () => {
  async function detectWith(config: string | null, env: NodeJS.ProcessEnv = {}) {
    const home = await mkdtemp(path.join(tmpdir(), "burnguard-codex-otel-"));
    try {
      if (config !== null) await writeFile(path.join(home, "config.toml"), config);
      return await detectUserCodexOtel({ ...env, CODEX_HOME: home });
    } finally { await rm(home, { recursive: true, force: true }); }
  }

  test("Given no config file or exporters that name no destination Then no user destination is detected", async () => {
    expect(await detectWith(null)).toBe(false);
    expect(await detectWith('model = "gpt-5"\n[otel]\nexporter = "none"\nmetrics_exporter = "statsig"\nenvironment = "dev"\n')).toBe(false);
    expect(await detectWith(null, { OTEL_EXPORTER_OTLP_ENDPOINT: "  ", OTEL_METRIC_EXPORT_INTERVAL: "5000" })).toBe(false);
  });

  test("Given an OTLP exporter in the Codex config or OTEL_EXPORTER_OTLP_* in the environment Then a user destination is detected", async () => {
    expect(await detectWith('[otel]\nmetrics_exporter = { otlp-http = { endpoint = "https://collector.example/v1/metrics", protocol = "binary" } }\n')).toBe(true);
    expect(await detectWith('[otel.exporter.otlp-grpc]\nendpoint = "https://collector.example:4317"\n')).toBe(true);
    expect(await detectWith('otel.trace_exporter = { otlp-http = { endpoint = "https://collector.example", protocol = "json" } }\n')).toBe(true);
    expect(await detectWith(null, { OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example" })).toBe(true);
  });

  test("Given a config that exists but cannot be parsed or read as a file Then detection is conservative and stays silent", async () => {
    const logged: unknown[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      expect(await detectWith("[otel\nexporter = ")).toBe(true);
      const home = await mkdtemp(path.join(tmpdir(), "burnguard-codex-otel-"));
      try {
        await mkdir(path.join(home, "config.toml"));
        expect(await detectUserCodexOtel({ CODEX_HOME: home })).toBe(true);
      } finally { await rm(home, { recursive: true, force: true }); }
    } finally { Object.assign(console, original); }
    expect(logged).toEqual([]);
  });

  test("Given the stored choice When the effective value is derived Then unset follows detection and an explicit choice wins", async () => {
    expect(codexProgressMetricsEffective(null, false)).toBe(true);
    expect(codexProgressMetricsEffective(null, true)).toBe(false);
    expect(codexProgressMetricsEffective(true, true)).toBe(true);
    expect(codexProgressMetricsEffective(false, false)).toBe(false);
    expect(await resolveCodexProgressMetrics(null, { OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example", CODEX_HOME: tmpdir() })).toBe(false);
    expect(await resolveCodexProgressMetrics(true, { OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example" })).toBe(true);
  });
});

describe("runCodexTurn image-tool lifecycle (real subprocess fixtures)", () => {
  for (const missingRoot of [false, true]) {
    runnerTest(`Given generated_images is ${missingRoot ? "missing" : "present"} When a PNG lands after watcher attachment Then its hash is delivered live exactly once`, async () => {
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

  runnerTest("Given a basename notification When a PNG exists in the current thread Then its hash is delivered before completion", async () => {
    await using fixture = await codexFixture({ controlledWatch: true });
    const imageFinished = Promise.withResolvers<void>();
    const run = fixture.start({ onEvent: async (event) => {
      if (event.type === "tool.finished") imageFinished.resolve();
    } });
    await fixture.ready;
    await fixture.imageAttached;
    const observed = Promise.race([imageFinished.promise, run.then(() => { throw new Error("image not delivered live"); })]);
    await fixture.image();
    imageWatch(fixture).emit("change", "rename", "exec-1.png");
    await observed;
    await fixture.command("complete");
    expect(await run).toEqual({ exitCode: 0 });
    expect(fixture.controller.signal.aborted).toBe(false);
    expect(fixture.events.filter((event) => event.type === "tool.finished")).toEqual([
      expect.objectContaining({ ok: true, output: { image_sha256: [PNG_SHA] } }),
    ]);
    expectGone(fixture.pids);
  });

  runnerTest("Given a silent owned child When a live callback rejects Then intake closes and settlement rejects with the same error without an external abort", async () => {
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

  runnerTest("Given a blocked stdout callback When a watcher scan and turn completion arrive Then parsing and callbacks preserve global delivery order", async () => {
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

  runnerTest("Given an in-flight image callback When stderr rejects Then owned cleanup closes intake and drains that callback before rejecting", async () => {
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

  runnerTest("Given a missing root When its parent reports a null filename Then attachment and the immediate hash sweep recover", async () => {
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

  runnerTest("Given an attached image watcher When it reports an error Then a replacement delivers the next null-name notification live", async () => {
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

  runnerTest("Given a missing image root When the parent watcher errors Then its replacement attaches the newly created root", async () => {
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

  runnerTest("Given a stdout event When its callback rejects Then the same error settles the owned process without synthetic completion", async () => {
    await using fixture = await codexFixture();
    const failure = new Error("stdout_persistence_unavailable");
    const run = fixture.start({ onEvent: async () => { throw failure; } });
    await fixture.ready;
    expect(await run).toBe(failure);
    expect(fixture.controller.signal.aborted).toBe(false);
    expect(fixture.events.map((event) => event.type)).toEqual(["chat.delta"]);
    expectGone(fixture.pids);
  });

  runnerTest("Given a generated_images symlink escaping Codex home When the parent reports its creation Then neither observation nor hashing escapes the boundary", async () => {
    await using fixture = await codexFixture({ missingRoot: true, controlledWatch: true });
    const run = fixture.start();
    await fixture.ready;
    // A junction needs no privilege on Windows; the type argument is ignored elsewhere.
    await symlink(fixture.root, fixture.imageRoot, "junction");
    parentWatch(fixture).emit("change", "rename", "generated_images");
    await fixture.command("complete");
    expect(await run).toEqual({ exitCode: 0 });
    // Watches outside the fixture tree are ignored: on Windows the owned-process receipt directory is watched too.
    const inFixture = fixture.watches.map((entry) => entry.path).filter((watched) => !path.relative(fixture.root, watched).startsWith(".."));
    // Listing the paths keeps the failure message naming the offender: only the Codex home may be watched.
    expect(inFixture.filter((watched) => watched !== fixture.home)).toEqual([]);
    expect(fixture.events.some((event) => event.type === "tool.started")).toBe(false);
  });

  runnerTest("Given an owned child and descendant When the turn is aborted Then both are gone before interrupted settlement", async () => {
    await using fixture = await codexFixture();
    const run = fixture.start();
    await fixture.ready;
    fixture.controller.abort();
    await run;
    expectGone(fixture.pids);
    expect(fixture.events.at(-1)).toMatchObject({ type: "status.idle", stopReason: "interrupted" });
  });
});
