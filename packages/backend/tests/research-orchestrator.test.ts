import { describe, expect, test } from "bun:test";
import type { ResearchFindingV1, ResearchRequestV1, ResearchResultV1, ResearchRule } from "@bg/shared";
import { executeResearch, type FetchedResearchSource, type ResearchDependencies, type ResearchSynthesisInput } from "../src/services/research-orchestrator";
import { loadNetworkResearchSource, ResearchSourceLoadError } from "../src/services/research-source-loader";

const PURPOSES = ["prototype.dashboard", "prototype.landing"] as const;
const request = (locators: readonly string[], concurrency = 2, mode: "live" | "fixture" = "live"): ResearchRequestV1 => ({
  schema_version: 1, purposes: PURPOSES,
  sources: locators.map((locator) => ({ kind: mode === "fixture" ? "fixture" : "web", locator })),
  limits: { concurrency, per_source_timeout_ms: 1_000, max_sources: 20, max_bytes_per_source: 128 },
  orchestrator_version: "research-v1", mode, fixture_id: mode === "fixture" ? "mass-research-v1" : null,
});
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let release: ((value: T) => void) | undefined;
  return { promise: new Promise<T>((resolve) => { release = resolve; }), resolve: (value) => release?.(value) };
}
function fetched(locator: string, size = 24): FetchedResearchSource {
  return { bytes: new TextEncoder().encode("x".repeat(size)), finalUrl: locator, httpStatus: 200, document: { schema_version: 1, title: locator, claims: [{ axis: "layout", text: "Evidence" }] } };
}
function finding(sourceId: string, contentDigest: string): ResearchFindingV1 {
  return { schema_version: 1, source_id: sourceId, content_digest: contentDigest, observations: [{ axis: "layout", summary: "Evidence", source_locator: sourceId }], candidates: [] };
}
function rule(id: string, sourceId: string): ResearchRule {
  return { id, axis: id, directive: id, rationale: "Supported", confidence: 0.8, source_ids: [sourceId] };
}
function synthesis(input: ResearchSynthesisInput): ResearchResultV1 {
  const sourceId = input.findings[0]?.source_id ?? "missing";
  return {
    schema_version: 1, run_id: input.runId, request_digest: input.requestDigest, evidence_set_digest: input.evidenceSetDigest,
    outcome: input.sourceSummary.failed === 0 ? "completed" : "partial", common_rules: [rule("common", sourceId)],
    purpose_rules: { "deck.pitch": [], "prototype.dashboard": [rule("dashboard", sourceId)], "prototype.diagram": [], "prototype.editorial": [], "prototype.landing": [rule("landing", sourceId)], "prototype.sandbox": [] },
    conflicts: [], source_summary: input.sourceSummary,
  };
}
function dependencies(overrides: Partial<ResearchDependencies> = {}): ResearchDependencies {
  let id = 0;
  return { now: () => 10, newId: () => `id-${++id}`, fetchSource: async ({ source }) => fetched(source.canonicalLocator), runWorker: async ({ source, fetched: data }) => finding(source.id, data.contentDigest), synthesize: async (input) => synthesis(input), ...overrides };
}

describe("research orchestration", () => {
  test("Given blocked workers When research fans out Then concurrency stays bounded", async () => {
    // Given
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()]; const twoStarted = deferred<void>();
    let active = 0; let maximum = 0; let started = 0;
    const deps = dependencies({ runWorker: async ({ source, fetched: data }) => { active += 1; started += 1; maximum = Math.max(maximum, active); if (started === 2) twoStarted.resolve(); await gates[source.ordinal]?.promise; active -= 1; return finding(source.id, data.contentDigest); } });
    // When
    const running = executeResearch(request(["https://a.test/", "https://b.test/", "https://c.test/", "https://d.test/"]), deps);
    await twoStarted.promise;
    // Then
    expect(started).toBe(2); expect(maximum).toBe(2); for (const gate of gates) gate.resolve(); expect((await running).status).toBe("completed");
  });

  test("Given duplicate, malformed, oversized, and failed sources When executed Then failures stay isolated", async () => {
    // Given
    const workers: string[] = [];
    const deps = dependencies({ fetchSource: async ({ source }) => source.canonicalLocator.includes("large") ? fetched(source.canonicalLocator, 129) : source.canonicalLocator.includes("bad") ? { ...fetched(source.canonicalLocator), document: { bad: true } } : fetched(source.canonicalLocator), runWorker: async ({ source, fetched: data }) => { workers.push(source.canonicalLocator); if (source.canonicalLocator.includes("worker")) throw new TypeError("failed"); return finding(source.id, data.contentDigest); } });
    // When
    const result = await executeResearch(request(["https://ok.test/a#one", "https://ok.test/a#two", "https://bad.test/", "https://large.test/", "https://worker.test/"]), deps);
    // Then
    expect(result.status).toBe("partial"); expect(result.sources.map((item) => item.status)).toEqual(["succeeded", "duplicate", "failed", "failed", "failed"]);
    expect(result.sources.map((item) => item.errorCode)).toEqual([null, null, "malformed_source", "fetch_failed", "worker_failed"]); expect(workers).toEqual(["https://ok.test/a", "https://worker.test/"]);
  });

  test("Given a controlled deadline When it fires Then only that source times out and timers are cleared", async () => {
    // Given
    const armed: Array<() => void> = []; const cleared: unknown[] = []; const siblingDone = deferred<void>();
    const deps = dependencies({ runWorker: async ({ source, fetched: data }, signal) => source.ordinal === 0 ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) : (siblingDone.resolve(), finding(source.id, data.contentDigest)), setTimer: (callback) => (armed.push(callback), callback), clearTimer: (handle) => { cleared.push(handle); } });
    // When
    const running = executeResearch(request(["https://timeout.test/", "https://ok.test/"]), deps); await siblingDone.promise; armed[0]?.(); const result = await running;
    // Then
    expect(result.sources.map((item) => item.errorCode)).toEqual(["source_timeout", null]); expect(cleared).toHaveLength(2);
  });

  test("Given cancellation racing active sources When cancellation wins Then no partial result is synthesized", async () => {
    // Given
    const controller = new AbortController(); const bothStarted = deferred<void>(); let started = 0; let syntheses = 0;
    const deps = dependencies({ runWorker: async (_input, signal) => new Promise((_, reject) => { started += 1; if (started === 2) bothStarted.resolve(); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }), synthesize: async (input) => { syntheses += 1; return synthesis(input); } });
    // When
    const running = executeResearch(request(["https://a.test/", "https://b.test/"]), deps, controller.signal); await bothStarted.promise; controller.abort(); const result = await running;
    // Then
    expect(result.status).toBe("cancelled"); expect(result.result).toBeNull(); expect(syntheses).toBe(0); expect(result.sources.every((item) => item.status === "cancelled")).toBe(true);
  });

  test("Given completion order changes When evidence repeats Then digests stay stable", async () => {
    // Given
    const run = async (reverse: boolean) => { const gates = [deferred<void>(), deferred<void>()]; const ready = deferred<void>(); let count = 0; let id = 0; const promise = executeResearch(request(["https://a.test/", "https://b.test/"]), dependencies({ newId: () => `stable-${++id}`, runWorker: async ({ source, fetched: data }) => { count += 1; if (count === 2) ready.resolve(); await gates[source.ordinal]?.promise; return finding(source.id, data.contentDigest); } })); await ready.promise; gates[reverse ? 1 : 0]?.resolve(); gates[reverse ? 0 : 1]?.resolve(); return promise; };
    // When
    const [first, second] = await Promise.all([run(false), run(true)]);
    // Then
    expect(second.evidenceSetDigest).toBe(first.evidenceSetDigest); expect(second.resultDigest).toBe(first.resultDigest);
  });

  test("Given the checked-in fixture When executed Then network, worker, and model dependencies are unused", async () => {
    // Given
    let calls = 0; const deps = dependencies({ fetchSource: async () => { calls += 1; throw new TypeError("network"); }, runWorker: async () => { calls += 1; throw new TypeError("worker"); }, synthesize: async () => { calls += 1; throw new TypeError("model"); } });
    // When
    const result = await executeResearch(request(["fixture-a", "fixture-b"], 2, "fixture"), deps);
    // Then
    expect(result.status).toBe("completed"); expect(calls).toBe(0); expect(result.result?.common_rules.length).toBeGreaterThan(0);
  });
});

describe("network source loading", () => {
  test("Given unsafe locators or oversized JSON When loaded Then bounded HTTPS policy rejects them", async () => {
    // Given
    const source = { id: "source", ordinal: 0, kind: "web", locator: "https://example.test/", canonicalLocator: "https://example.test/" } as const;
    const transport = async () => new Response(JSON.stringify({ schema_version: 1, title: "x", claims: [{ axis: "layout", text: "x".repeat(200) }] }), { status: 200, headers: { "content-type": "application/json" } });
    // When / Then
    await expect(loadNetworkResearchSource({ source: { ...source, locator: "https://user:secret@example.test/", canonicalLocator: "https://user:secret@example.test/" }, maxBytes: 128, request: transport }, new AbortController().signal)).rejects.toBeInstanceOf(ResearchSourceLoadError);
    await expect(loadNetworkResearchSource({ source: { ...source, locator: "https://127.0.0.1/", canonicalLocator: "https://127.0.0.1/" }, maxBytes: 128, request: transport }, new AbortController().signal)).rejects.toBeInstanceOf(ResearchSourceLoadError);
    await expect(
      loadNetworkResearchSource(
        { source, maxBytes: 128, request: transport },
        new AbortController().signal,
        {
          resolveAddresses: async () => [
            { address: "93.184.216.34", family: 4 },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "source_too_large" });
  });
});
