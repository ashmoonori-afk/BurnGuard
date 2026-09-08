import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResearchDependencies } from "../src/services/research-orchestrator";
import { runMigrationsFrom } from "../src/db/migrate";
import { getResearchRun } from "../src/db/research-repository";
import { createResearchRoutes } from "../src/routes/research";
import { classifyApiRoute } from "../src/server";
import { buildHappyReceipt } from "../../../scripts/qa/mass-research-dry-run";
import { executeResearch } from "../src/services/research-orchestrator";
import { createProductionResearchDependencies } from "../src/routes/research";

const fixtureRequest = { schema_version: 1, purposes: ["prototype.dashboard", "prototype.landing"], sources: [{ kind: "fixture", locator: "fixture-a" }, { kind: "fixture", locator: "fixture-b" }], limits: { concurrency: 2, per_source_timeout_ms: 1_000, max_sources: 8, max_bytes_per_source: 1_024 }, orchestrator_version: "research-v1", mode: "fixture", fixture_id: "mass-research-v1" } as const;
let db: Database; let evidenceRoot = "";
beforeEach(async () => { db = new Database(":memory:"); db.exec("PRAGMA foreign_keys = ON"); await runMigrationsFrom(db, fileURLToPath(new URL("../src/db/migrations", import.meta.url))); evidenceRoot = await mkdtemp(path.join(tmpdir(), "burnguard-research-routes-")); });
afterEach(async () => { db.close(); await rm(evidenceRoot, { recursive: true, force: true }); });

describe("research API", () => {
  test("Given a fixture request When dry-run planning is requested Then the plan is deterministic and storage remains untouched", async () => {
    // Given
    const api = createResearchRoutes({ db });
    // When
    const request = () => api.routes.request("http://local/api/research/dry-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fixtureRequest) }); const first = await request(); const second = await request();
    // Then
    expect(first.status).toBe(200); expect(await first.json()).toEqual(await second.json()); expect(db.query("SELECT COUNT(*) count FROM research_runs").get()).toEqual({ count: 0 });
  });
  test("Given a named fixture When a run completes Then read exposes bounded progress, rules, and sanitized provenance", async () => {
    // Given
    const api = createResearchRoutes({ db });
    // When
    const started = await api.routes.request("http://local/api/research/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_key: "route-happy", request: fixtureRequest }) }); const startBody = await started.json(); const runId = startBody.data.id; await api.waitForRun(runId); const response = await api.routes.request(`http://local/api/research/runs/${runId}`); const body = await response.json();
    // Then
    expect(started.status).toBe(202); expect(response.status).toBe(200); expect(body.data).toMatchObject({ id: runId, status: "completed", progress: { requested: 2, canonical: 2, succeeded: 2, failed: 0, duplicates: 0 }, result: { outcome: "completed" } }); expect(JSON.stringify(body)).not.toContain("Keyboard focus remains visible");
  });
  test("Given an active run When cancellation is requested Then cancellation is durable before worker abort", async () => {
    // Given
    let releaseStarted: (() => void) | undefined; const started = new Promise<void>((resolve) => { releaseStarted = resolve; }); let persistedBeforeAbort = false;
    const dependencies: ResearchDependencies = { now: () => Date.now(), newId: () => crypto.randomUUID(), fetchSource: async ({ source }) => ({ bytes: new TextEncoder().encode("{}"), finalUrl: source.locator, httpStatus: 200, document: { schema_version: 1, title: "safe", claims: [{ axis: "layout", text: "safe" }] } }), runWorker: async (_input, signal) => new Promise((_, reject) => { releaseStarted?.(); signal.addEventListener("abort", () => { persistedBeforeAbort = getResearchRun(db, "cancel-run").status === "cancelled"; reject(signal.reason); }, { once: true }); }), synthesize: async () => { throw new TypeError("must not synthesize"); } };
    const api = createResearchRoutes({ db, dependencies, ids: ["cancel-run", "cancel-source", "execution-run", "execution-source"] }); const liveRequest = { ...fixtureRequest, mode: "live", fixture_id: null, purposes: ["prototype.dashboard"], sources: [{ kind: "web", locator: "https://example.test/research" }] }; await api.routes.request("http://local/api/research/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_key: "route-cancel", request: liveRequest }) }); await started;
    // When
    const cancelled = await api.routes.request("http://local/api/research/runs/cancel-run/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); await api.waitForRun("cancel-run");
    // Then
    expect(cancelled.status).toBe(200); expect(persistedBeforeAbort).toBe(true); expect(getResearchRun(db, "cancel-run").status).toBe("cancelled");
  });
  test("Given disallowed fields, URLs, or fixtures When parsed Then typed errors reject without writes", async () => {
    // Given
    const api = createResearchRoutes({ db }); const inputs = [{ ...fixtureRequest, extra: true }, { ...fixtureRequest, mode: "live", fixture_id: null, sources: [{ kind: "web", locator: "http://example.test/research" }] }, { ...fixtureRequest, fixture_id: "unknown-fixture" }];
    // When
    const responses = await Promise.all(inputs.map((input) => api.routes.request("http://local/api/research/dry-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })));
    // Then
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]); expect((await responses[0]?.json()).error.code).toBe("invalid_research_request"); expect(db.query("SELECT COUNT(*) count FROM research_runs").get()).toEqual({ count: 0 });
  });
  test("Given research paths When classified Then server dispatches the research domain", () => {
    // Given / When / Then
    expect(classifyApiRoute("/api/research/runs", "POST")).toBe("research"); expect(classifyApiRoute("/api/research/runs/id", "GET")).toBe("research");
  });
});

describe("mass research CLI", () => {
  test("Given executeResearch returns product-owned identity and rules When the happy receipt is built Then it serializes that execution without resynthesis", async () => {
    // Given
    const ids = ["qa-run", "qa-source-1", "qa-source-2"];
    const execution = await executeResearch(fixtureRequest, { ...createProductionResearchDependencies(fixtureRequest), newId: () => ids.shift() ?? "unused" });
    if (execution.result === null) throw new TypeError("fixture execution did not return a result");
    const sentinelDigest = "f".repeat(64);
    const sentinelExecution = { ...execution, resultDigest: sentinelDigest, result: { ...execution.result, common_rules: execution.result.common_rules.map((rule, index) => index === 0 ? { ...rule, directive: "product sentinel directive" } : rule) } };
    // When
    const receipt = await buildHappyReceipt(fixtureRequest, async () => sentinelExecution);
    // Then
    expect(receipt.digest).toBe(sentinelDigest);
    expect(receipt.result).toBe(sentinelExecution.result);
    expect(receipt.common_rules).toBe(sentinelExecution.result.common_rules);
    expect(receipt.provenance[0]).toMatchObject({ rule_id: sentinelExecution.result.common_rules[0]?.id, source_id: sentinelExecution.result.common_rules[0]?.source_ids[0] });
  });

  test("Given happy and adversarial fixtures When exact QA commands run Then cleanup receipts pass", async () => {
    // Given
    const root = path.resolve(import.meta.dir, "../../.."); const scenarios = [["--fixture", "scripts/qa/fixtures/mass-research.json", "--purpose", "prototype"], ["--fixture", "scripts/qa/fixtures/mass-research-adversarial.json", "--scenario", "failures"]] as const;
    // When
    const receipts = [];
    for (const [index, args] of scenarios.entries()) {
      const evidence = path.join(evidenceRoot, `case-${index}`);
      const child = Bun.spawn([process.execPath, "run", "scripts/qa/mass-research-dry-run.ts", ...args, "--evidence-dir", evidence], { cwd: root, env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
      const deadline = setTimeout(() => child.kill(), 45_000);
      const [exitCode, , stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => clearTimeout(deadline));
      expect(exitCode, stderr).toBe(0);
      receipts.push(JSON.parse(await readFile(path.join(evidence, "receipt.json"), "utf8")));
    }
    // Then
    expect(receipts[0]).toMatchObject({ ok: true, bounded_concurrency: true, cleanup: { complete: true } }); expect(receipts[0].digest).toMatch(/^[0-9a-f]{64}$/); expect(receipts[0].common_rules.length).toBeGreaterThan(0); expect(receipts[0].purpose_rules.length).toBeGreaterThan(0); expect(receipts[1]).toMatchObject({ ok: true, cleanup: { complete: true } }); expect(receipts[1].cases.every((item: { readonly passed: boolean }) => item.passed)).toBe(true);
    // Spawns the QA runner over every fixture; the default 5 s budget is too
    // tight for that much Windows file IO, and 30 s still fails a real hang.
  }, 30_000);
});
