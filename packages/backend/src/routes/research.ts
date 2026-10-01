import type { Database } from "bun:sqlite";
import { UpgradeContractError, parseResearchRequestV1, type ResearchFindingV1, type ResearchProjectPurpose, type ResearchRequestV1, type ResearchResultV1, type ResearchRule } from "@bg/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { beginResearchFinalization, claimResearchSource, commitResearchResult, completeResearchSource, createResearchRun, failResearchSource, getResearchRun, listResearchSources, requestResearchCancellation, ResearchConflictError, startResearchRun } from "../db/research-repository";
import { getSqlite } from "../db/sqlite-client";
import { canonicalJson, sha256 } from "../services/export-receipt";
import { executeResearch, type ResearchDependencies, type ResearchExecution, type ResearchSynthesisInput } from "../services/research-orchestrator";
import type { ResearchRecoveryDependencies } from "../services/research-recovery";
import { loadNetworkResearchSource } from "../services/research-source-loader";

const FIXTURE_ID = "mass-research-v1";
const FIXTURE_LOCATORS = new Set(["fixture-a", "fixture-b"]);
const TERMINAL = new Set(["completed", "partial", "cancelled", "failed", "corrupt"]);

export class ResearchRouteError extends Error {
  readonly name = "ResearchRouteError";
  constructor(readonly code: "invalid_research_request" | "research_not_found" | "research_conflict", readonly field: string) { super(`${code}: ${field}`); }
}

type RouteOptions = { readonly db: Database; readonly dependencies?: ResearchDependencies; readonly ids?: readonly string[] };
type RouteAuthority = { readonly routes: Hono; readonly waitForRun: (runId: string) => Promise<void> };
type RunInput = { readonly db: Database; readonly runId: string; readonly request: ResearchRequestV1; readonly sourceIds: readonly string[]; readonly dependencies?: ResearchDependencies; readonly signal: AbortSignal };

export function createResearchRoutes(options: RouteOptions): RouteAuthority {
  const routes = new Hono();
  const active = new Map<string, { readonly controller: AbortController; readonly completion: Promise<void> }>();
  const suppliedIds = [...(options.ids ?? [])];
  const nextId = (): string => suppliedIds.shift() ?? crypto.randomUUID();

  routes.post("/api/research/dry-run", async (c) => {
    try { return c.json({ data: planResearchRequest(parseRouteRequest(await jsonBody(c))) }); }
    catch (error) { return routeError(c, error); }
  });
  routes.post("/api/research/runs", async (c) => {
    try {
      const input = await jsonBody(c); const envelope = parseStartEnvelope(input); const request = parseRouteRequest(envelope.request);
      const created = createResearchRun(options.db, { requestKey: envelope.requestKey, request, orchestratorDigest: sha256("research-v1"), now: Date.now(), newId: nextId });
      if (!TERMINAL.has(created.run.status) && !active.has(created.run.id)) {
        startResearchRun(options.db, { runId: created.run.id, now: Date.now() });
        const controller = new AbortController();
        const completion = runAndPersist({ db: options.db, runId: created.run.id, request, sourceIds: created.sources.map((source) => source.id), dependencies: options.dependencies, signal: controller.signal })
          .catch((error: unknown) => markRunFailed(options.db, created.run.id, error))
          .finally(() => active.delete(created.run.id));
        active.set(created.run.id, { controller, completion });
      }
      return c.json({ data: publicRun(options.db, created.run.id) }, 202);
    } catch (error) { return routeError(c, error); }
  });
  routes.get("/api/research/runs/:id", (c) => {
    try { return c.json({ data: publicRun(options.db, c.req.param("id")) }); }
    catch (error) { return routeError(c, error); }
  });
  routes.post("/api/research/runs/:id/cancel", async (c) => {
    try {
      parseEmpty(await jsonBody(c)); const runId = c.req.param("id");
      requestResearchCancellation(options.db, { runId, now: Date.now() });
      active.get(runId)?.controller.abort();
      return c.json({ data: publicRun(options.db, runId) });
    } catch (error) { return routeError(c, error); }
  });
  return { routes, waitForRun: async (runId) => { await active.get(runId)?.completion; } };
}

export function planResearchRequest(request: ResearchRequestV1) {
  const first = new Map<string, number>();
  const sources = request.sources.map((source, ordinal) => {
    const locator = canonicalLocator(source.kind, source.locator); const key = `${source.kind}:${locator}`; const duplicateOf = first.get(key) ?? null;
    if (duplicateOf === null) first.set(key, ordinal);
    return { ordinal, kind: source.kind, locator: publicLocator(source.kind, locator), duplicate_of: duplicateOf };
  });
  const plan = { schema_version: 1 as const, mode: request.mode, fixture_id: request.fixture_id, purposes: request.purposes, limits: request.limits, sources, canonical_sources: first.size };
  return { ...plan, digest: sha256(canonicalJson(plan)) };
}

async function runAndPersist(input: RunInput): Promise<void> {
  const executionIds = [input.runId, ...input.sourceIds];
  const dependencies = { ...(input.dependencies ?? createProductionResearchDependencies(input.request)), newId: () => executionIds.shift() ?? crypto.randomUUID() };
  const execution = await executeResearch(input.request, dependencies, input.signal);
  if (execution.status === "cancelled") { if (getResearchRun(input.db, input.runId).status !== "cancelled") requestResearchCancellation(input.db, { runId: input.runId, now: Date.now() }); return; }
  persistSources(input.db, input.runId, execution);
  if (execution.result === null) { markRunFailed(input.db, input.runId, new ResearchRouteError("research_conflict", "no_usable_result")); return; }
  const evidenceSetDigest = beginResearchFinalization(input.db, { runId: input.runId, now: Date.now() });
  commitResearchResult(input.db, { runId: input.runId, evidenceSetDigest, result: execution.result, now: Date.now() });
}

function persistSources(db: Database, runId: string, execution: ResearchExecution, records = listResearchSources(db, runId)): void {
  for (const outcome of execution.sources) {
    const record = records[outcome.source.ordinal];
    if (record === undefined || record.status === "duplicate") continue;
    const claimed = claimResearchSource(db, { runId, sourceId: record.id, now: outcome.startedAt ?? Date.now() });
    if (outcome.status === "succeeded" && outcome.finding !== null && outcome.contentDigest !== null) {
      completeResearchSource(db, { sourceId: record.id, attemptToken: claimed.attempt_count, contentDigest: outcome.contentDigest, evidence: { final_url: publicLocator(record.kind, record.canonical_locator) }, finding: outcome.finding, now: outcome.finishedAt });
    } else if (outcome.status === "failed" && outcome.errorCode !== null && outcome.errorCode !== "user_cancelled" && outcome.errorCode !== "persisted_data_corrupt") {
      failResearchSource(db, { sourceId: record.id, attemptToken: claimed.attempt_count, errorCode: outcome.errorCode, message: outcome.errorCode, now: outcome.finishedAt });
    }
  }
}

export function createProductionResearchDependencies(request: ResearchRequestV1): ResearchDependencies {
  return {
    now: () => Date.now(), newId: () => crypto.randomUUID(),
    fetchSource: (input, signal) => loadNetworkResearchSource({ ...input, request: (url, init) => Bun.fetch(url, init) }, signal),
    runWorker: async ({ source, fetched }): Promise<ResearchFindingV1> => ({ schema_version: 1, source_id: source.id, content_digest: fetched.contentDigest, observations: fetched.document.claims.map((claim) => ({ axis: claim.axis, summary: `Structured evidence supplied for ${claim.axis}.`, source_locator: publicLocator(source.kind, source.locator) })), candidates: fetched.document.claims.flatMap((claim) => ["common" as const, ...request.purposes].map((purpose) => ({ purpose, axis: claim.axis, directive: `Apply source-grounded ${claim.axis} guidance.`, rationale: "A bounded structured source supports this axis.", confidence: 0.7 }))) }),
    synthesize: async (input) => synthesize(input),
  };
}

export function createProductionResearchRecoveryDependencies(db: Database): ResearchRecoveryDependencies {
  return {
    now: () => Date.now(),
    enqueue: async (runId) => {
      const run = getResearchRun(db, runId);
      const request = parseResearchRequestV1(run.request_json);
      const pending = listResearchSources(db, runId).filter((source) => source.duplicate_of_source_id === null && source.status === "pending");
      if (pending.length === 0) return;
      const retryRequest = parseResearchRequestV1({ ...request, sources: pending.map((source) => ({ kind: source.kind, locator: source.canonical_locator })) });
      startResearchRun(db, { runId, now: Date.now() });
      const executionIds = [runId, ...pending.map((source) => source.id)];
      const dependencies = { ...createProductionResearchDependencies(retryRequest), newId: () => executionIds.shift() ?? crypto.randomUUID() };
      const execution = await executeResearch(retryRequest, dependencies);
      persistSources(db, runId, execution, pending);
    },
    synthesize: async (input) => createProductionResearchDependencies(input.request).synthesize(input, new AbortController().signal),
  };
}

function synthesize(input: ResearchSynthesisInput): ResearchResultV1 {
  const candidates = input.findings.flatMap((finding) => finding.candidates.map((candidate, index) => ({ candidate, sourceId: finding.source_id, index })));
  const rules = (purpose: ResearchProjectPurpose | "common"): readonly ResearchRule[] => candidates.filter((item) => item.candidate.purpose === purpose).map(({ candidate, sourceId, index }) => ({ id: `${purpose}-${sourceId}-${index}`, axis: candidate.axis, directive: candidate.directive, rationale: candidate.rationale, confidence: candidate.confidence, source_ids: [sourceId] })).sort((left, right) => left.id.localeCompare(right.id));
  return { schema_version: 1, run_id: input.runId, request_digest: input.requestDigest, evidence_set_digest: input.evidenceSetDigest, outcome: input.sourceSummary.failed === 0 ? "completed" : "partial", common_rules: rules("common"), purpose_rules: { "deck.pitch": rules("deck.pitch"), "prototype.dashboard": rules("prototype.dashboard"), "prototype.diagram": rules("prototype.diagram"), "prototype.editorial": rules("prototype.editorial"), "prototype.landing": rules("prototype.landing"), "prototype.sandbox": rules("prototype.sandbox") }, conflicts: [], source_summary: input.sourceSummary };
}

function publicRun(db: Database, runId: string) {
  let run;
  try { run = getResearchRun(db, runId); }
  catch (error) { if (error instanceof ResearchConflictError) throw new ResearchRouteError("research_not_found", "id"); throw error; }
  const sources = listResearchSources(db, runId); const canonical = sources.filter((source) => source.duplicate_of_source_id === null);
  const result = run.result_json === null ? null : JSON.parse(run.result_json);
  return { id: run.id, status: run.status, mode: run.mode, fixture_id: run.fixture_id, request_digest: run.request_digest, result_digest: run.result_digest, cancel_requested_at: run.cancel_requested_at, progress: { requested: sources.length, canonical: canonical.length, succeeded: canonical.filter((source) => source.status === "succeeded").length, failed: canonical.filter((source) => source.status === "failed" || source.status === "corrupt").length, duplicates: sources.length - canonical.length }, sources: sources.map((source) => ({ id: source.id, ordinal: source.ordinal, kind: source.kind, locator: publicLocator(source.kind, source.canonical_locator), status: source.status, error_code: source.error_code })), result };
}

function parseRouteRequest(input: unknown): ResearchRequestV1 {
  let request: ResearchRequestV1;
  try { request = parseResearchRequestV1(input); } catch (error) { if (error instanceof UpgradeContractError) throw new ResearchRouteError("invalid_research_request", "request"); throw error; }
  if (request.mode === "fixture") { if (request.fixture_id !== FIXTURE_ID || request.sources.some((source) => source.kind !== "fixture" || !FIXTURE_LOCATORS.has(source.locator))) throw new ResearchRouteError("invalid_research_request", "fixture_id"); }
  else if (request.sources.some((source) => (source.kind !== "web" && source.kind !== "repository") || new URL(source.locator).protocol !== "https:" || new URL(source.locator).username.length > 0 || new URL(source.locator).password.length > 0)) throw new ResearchRouteError("invalid_research_request", "sources");
  return request;
}
function parseStartEnvelope(input: unknown): { readonly requestKey: string; readonly request: unknown } { if (!record(input) || Object.keys(input).length !== 2 || typeof input["request_key"] !== "string" || input["request_key"].trim().length === 0 || !("request" in input)) throw new ResearchRouteError("invalid_research_request", "body"); return { requestKey: input["request_key"], request: input["request"] }; }
function parseEmpty(input: unknown): void { if (!record(input) || Object.keys(input).length !== 0) throw new ResearchRouteError("invalid_research_request", "body"); }
async function jsonBody(c: Context): Promise<unknown> { try { return await c.req.json(); } catch (error) { if (error instanceof SyntaxError) throw new ResearchRouteError("invalid_research_request", "body"); throw error; } }
function routeError(c: Context, error: unknown): Response { if (error instanceof ResearchRouteError) return c.json({ error: { code: error.code, message: error.message, field: error.field } }, error.code === "research_not_found" ? 404 : error.code === "research_conflict" ? 409 : 400); if (error instanceof ResearchConflictError) return c.json({ error: { code: "research_conflict", message: error.message } }, 409); console.warn("[research] request failed", error instanceof Error ? String(Reflect.get(error, "code") ?? error.name) : "unknown"); return c.json({ error: { code: "research_operation_failed", message: "Research operation failed" } }, 500); }
function markRunFailed(db: Database, runId: string, _error: unknown): void { db.prepare("UPDATE research_runs SET status='failed',stop_reason='orchestration_failed',usable=0,completed_at=?,updated_at=? WHERE id=? AND status IN ('pending','running','finalizing','recovering')").run(Date.now(), Date.now(), runId); }
function canonicalLocator(kind: ResearchRequestV1["sources"][number]["kind"], locator: string): string { if (kind === "fixture" || kind === "document") return locator.trim().normalize("NFC"); const url = new URL(locator.trim().normalize("NFC")); url.hash = ""; return url.toString().replace(/\/$/u, url.pathname === "/" ? "/" : ""); }
function publicLocator(kind: ResearchRequestV1["sources"][number]["kind"], locator: string): string { if (kind === "fixture") return locator; const url = new URL(locator); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
function record(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }

const authority = createResearchRoutes({ db: getSqlite() });
export const researchRoutes = authority.routes;
