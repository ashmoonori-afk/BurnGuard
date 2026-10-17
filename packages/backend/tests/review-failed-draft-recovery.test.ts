import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DESIGN_AUDIT_CHECK_CODES, type ArtifactHistoryV1, type DesignAuditResult } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { getProjectDetail } from "../src/db/seed";
import { projectsDir, resolveManagedPath } from "../src/lib/paths";
import { artifactOperationRoutes } from "../src/routes/artifact-operations";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { writeProjectAuditCache } from "../src/services/design-audit";
import { readUnverifiedDraft, recoverReviewFailedDraft } from "../src/services/review-failed-recovery";
import { startUserTurn, type TurnDependencies } from "../src/services/turns";

let projectId: string;
let sessionId: string;
let projectDir: string;
let digest: string;
const createdDrafts: string[] = [];
beforeAll(async () => { await runMigrations(); await mkdir(projectsDir, { recursive: true }); });
beforeEach(async () => {
  projectId = `review-draft-${crypto.randomUUID()}`;
  sessionId = `${projectId}-session`;
  projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir);
  await writeFile(path.join(projectDir, "index.html"), "base");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  digest = (await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir)).tree_digest;
});
afterEach(async () => {
  for (const id of [projectId, ...createdDrafts.splice(0)]) {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id);
    await rm(path.join(projectsDir, id), { recursive: true, force: true });
  }
});

function mustFix(): DesignAuditResult {
  return { schema_version: 1, project_id: projectId, artifact_revision: 1, artifact_digest: digest, created_at: 1, overall_status: "must_fix", checks: [{ code: "text_overflow", status: "fail", reason: null, findings: [{ id: "fixture", check_code: "text_overflow", severity: "must_fix", source: { rel_path: "index.html", node_bg_id: "fixture" }, evidence: "fixture", targeted_action: "expand_or_reflow_text" }] }] };
}

/** A real turn whose design review fails: the stage keeps the generated files and the project keeps its last good revision. */
async function failedReviewTurn(): Promise<{ operationId: string; stageDir: string }> {
  const turn = startUserTurn(sessionId, { type: "user.message", text: "Create a result", attachments: [] }, undefined, {
    detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture", version: "test" }] }),
    runAdapter: async (_backend, input) => {
      await writeFile(path.join(input.projectDir, "index.html"), "<!doctype html><link rel=stylesheet href=site.css><p>Generated</p>");
      await writeFile(path.join(input.projectDir, "site.css"), "p{color:#123456}");
      return { exitCode: 0 };
    },
    reviewDesign: async () => ({ status: "checked", repairs: 2, result: mustFix() }),
  } satisfies TurnDependencies);
  if (turn === null) throw new Error("turn reservation unavailable");
  await turn.promise;
  expect(getSqlite().prepare("SELECT status FROM artifact_operations WHERE id=?").get(turn.operationId)).toEqual({ status: "failed" });
  return { operationId: turn.operationId, stageDir: path.join(projectDir, ".meta", "artifact-operations", turn.operationId, "stage") };
}

const call = async (method: string, url: string) => {
  const response = await artifactOperationRoutes.request(`http://local${url}`, { method });
  return { status: response.status, text: await response.text() };
};
const parse = <T>(text: string): { data?: T; error?: { code: string } } => JSON.parse(text);
const projectCount = () => getSqlite().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects").get()!.n;

test("Given a review-failed operation When recovered after a reopen Then a separate unverified draft holds exactly the stage bytes and the original is untouched", async () => {
  const { operationId, stageDir } = await failedReviewTurn();
  const original = await getProjectDetail(projectId);
  const originalTree = await inspectCanonicalTree(projectDir);
  const stageTree = await inspectCanonicalTree(stageDir);

  const listed = parse<ArtifactHistoryV1>((await call("GET", `/api/projects/${projectId}/history`)).text);
  expect(listed.data?.review_failed_drafts).toEqual([{ operation_id: operationId, failed_at: expect.any(Number), retained_until: expect.any(Number), incomplete_checks: ["text_overflow"] }]);

  // A fresh coordinator and route call stand in for a restarted process on the same app root.
  const recovered = await call("POST", `/api/projects/${projectId}/operations/${operationId}/recover-draft`);
  expect(recovered.status).toBe(200);
  expect(recovered.text).not.toContain(projectsDir);
  const draft = parse<{ project_id: string; session_id: string; entrypoint: string }>(recovered.text).data!;
  createdDrafts.push(draft.project_id);
  expect(draft.project_id).not.toBe(projectId);

  const draftDetail = (await getProjectDetail(draft.project_id))!;
  const draftDir = resolveManagedPath(projectsDir, draftDetail.dir_path);
  const draftTree = await inspectCanonicalTree(draftDir);
  expect(draftTree.tree_digest).toBe(stageTree.tree_digest);
  for (const file of stageTree.files) expect(await readFile(path.join(draftDir, file.path))).toEqual(await readFile(path.join(stageDir, file.path)));
  expect(draftDetail.current_digest).toBe(stageTree.tree_digest);

  expect(await inspectCanonicalTree(projectDir)).toEqual(originalTree);
  const after = await getProjectDetail(projectId);
  expect([after?.current_revision, after?.current_digest]).toEqual([original?.current_revision, original?.current_digest]);

  const state = await readUnverifiedDraft(draftDir, draftDetail);
  expect(state).toEqual({ schema_version: 1, reason: "design_review_failed", incomplete_checks: ["text_overflow"], retained_until: listed.data!.review_failed_drafts[0]!.retained_until, recovered_at: expect.any(Number), source_project_id: projectId, source_operation_id: operationId });
  expect(existsSync(path.join(draftDir, ".meta", "audits"))).toBe(false);
  const stateRoute = parse<unknown>((await call("GET", `/api/projects/${draft.project_id}/unverified-draft`)).text);
  expect(stateRoute.data).toMatchObject({ reason: "design_review_failed", incomplete_checks: ["text_overflow"] });

  // A manual edit is a new revision but not a verification: the flag stays until an audit of that revision passes.
  const edited = await new ArtifactCoordinator(getSqlite()).run({ projectId: draft.project_id, projectDir: draftDir, kind: "turn", expectedRevision: draftDetail.current_revision, expectedArtifactDigest: draftDetail.current_digest!, mutate: async stage => { await writeFile(path.join(stage, "site.css"), "p{color:#654321}"); } });
  const editedIdentity = { id: draft.project_id, current_revision: edited.resultRevision, current_digest: edited.resultDigest };
  expect(await readUnverifiedDraft(draftDir, editedIdentity)).toMatchObject({ reason: "design_review_failed" });
  const audit = (blocked: boolean): DesignAuditResult => ({ ...mustFix(), project_id: draft.project_id, artifact_revision: edited.resultRevision, artifact_digest: edited.resultDigest, overall_status: blocked ? "must_fix" : "ready", checks: DESIGN_AUDIT_CHECK_CODES.map(code => blocked && code === "text_overflow" ? mustFix().checks[0]! : { code, status: "pass" as const, reason: null, findings: [] }) });
  await writeProjectAuditCache(draftDir, audit(true));
  expect(await readUnverifiedDraft(draftDir, editedIdentity)).toMatchObject({ reason: "design_review_failed" });
  // An audit that could measure nothing is "recommended", not a pass: the flag stays.
  await writeProjectAuditCache(draftDir, { ...audit(false), overall_status: "recommended", checks: DESIGN_AUDIT_CHECK_CODES.map(code => ({ code, status: "unmeasurable" as const, reason: "unresolvable_rendering" as const, findings: [] })) });
  expect(await readUnverifiedDraft(draftDir, editedIdentity)).toMatchObject({ reason: "design_review_failed" });
  await writeProjectAuditCache(draftDir, audit(false));
  expect(await readUnverifiedDraft(draftDir, editedIdentity)).toBeNull();
});

test("Given a retention-expired operation When recovering Then it is refused with recovery_expired and no project is created", async () => {
  const { operationId } = await failedReviewTurn();
  getSqlite().prepare("UPDATE artifact_operations SET retention_json=json_set(retention_json,'$.retained_until',?) WHERE id=?").run(Date.now() - 1, operationId);
  const before = projectCount();
  await expect(recoverReviewFailedDraft(getSqlite(), { projectId, operationId })).rejects.toMatchObject({ code: "draft_recovery_expired" });
  const response = await call("POST", `/api/projects/${projectId}/operations/${operationId}/recover-draft`);
  expect(response.status).toBe(410);
  expect(parse<unknown>(response.text).error?.code).toBe("draft_recovery_expired");
  expect(response.text).not.toContain(projectDir);
  expect(parse<ArtifactHistoryV1>((await call("GET", `/api/projects/${projectId}/history`)).text).data?.review_failed_drafts).toEqual([]);
  expect(projectCount()).toBe(before);
});

test("Given a stage whose bytes changed after the failure When recovering Then it is refused as corrupt", async () => {
  const { operationId, stageDir } = await failedReviewTurn();
  await appendFile(path.join(stageDir, "site.css"), "/* tampered */");
  const before = projectCount();
  await expect(recoverReviewFailedDraft(getSqlite(), { projectId, operationId })).rejects.toMatchObject({ code: "draft_recovery_corrupt" });
  expect((await call("POST", `/api/projects/${projectId}/operations/${operationId}/recover-draft`)).status).toBe(409);
  expect(projectCount()).toBe(before);
});

test("Given a stage holding bytes the failed turn must not publish When recovering Then it is refused as disallowed", async () => {
  const { operationId, stageDir } = await failedReviewTurn();
  const receiptPath = path.join(path.dirname(stageDir), "review-failure.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { forbidden_sha256: string[] };
  receipt.forbidden_sha256 = [createHash("sha256").update(await readFile(path.join(stageDir, "site.css"))).digest("hex")];
  await writeFile(receiptPath, JSON.stringify(receipt));
  const before = projectCount();
  await expect(recoverReviewFailedDraft(getSqlite(), { projectId, operationId })).rejects.toMatchObject({ code: "draft_recovery_disallowed" });
  expect((await call("POST", `/api/projects/${projectId}/operations/${operationId}/recover-draft`)).status).toBe(422);
  expect(projectCount()).toBe(before);
});

test("Given a removed stage or a committed operation When recovering Then it is refused as unavailable", async () => {
  const { operationId, stageDir } = await failedReviewTurn();
  const committed = await new ArtifactCoordinator(getSqlite()).run({ projectId, projectDir, kind: "turn", expectedRevision: 0, expectedArtifactDigest: digest, mutate: async stage => { await writeFile(path.join(stage, "index.html"), "second"); } });
  await expect(recoverReviewFailedDraft(getSqlite(), { projectId, operationId: committed.id })).rejects.toMatchObject({ code: "draft_recovery_unavailable" });
  await rm(stageDir, { recursive: true, force: true });
  await expect(recoverReviewFailedDraft(getSqlite(), { projectId, operationId })).rejects.toMatchObject({ code: "draft_recovery_unavailable" });
  expect((await call("POST", `/api/projects/${projectId}/operations/${operationId}/recover-draft`)).status).toBe(404);
});
