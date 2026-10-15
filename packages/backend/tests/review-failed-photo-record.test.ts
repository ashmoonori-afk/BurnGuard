import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DESIGN_AUDIT_CHECK_CODES, PHOTO_PLACEMENTS_FILE, type DesignAuditResult } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { getProjectDetail } from "../src/db/seed";
import { projectsDir, resolveManagedPath } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { readPhotoPlacements } from "../src/services/photo-placements";
import { recoverReviewFailedDraft } from "../src/services/review-failed-recovery";
import { startUserTurn, type TurnDependencies } from "../src/services/turns";

let projectId: string;
let sessionId: string;
let projectDir: string;
let digest: string;
const createdDrafts: string[] = [];
const REFERENCE = ".meta/references/lamp.png";
const REFERENCE_BYTES = Buffer.from("synthetic reference bytes");

beforeAll(async () => { await runMigrations(); await mkdir(projectsDir, { recursive: true }); });
beforeEach(async () => {
  projectId = `review-photo-${crypto.randomUUID()}`;
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
  return { schema_version: 1, project_id: projectId, artifact_revision: 1, artifact_digest: digest, created_at: 1, overall_status: "must_fix", checks: [{ code: "text_overflow", status: "fail", reason: null, findings: [{ id: "fixture", check_code: "text_overflow", severity: "must_fix", source: { rel_path: "index.html", node_bg_id: null }, evidence: "fixture", targeted_action: "expand_or_reflow_text" }] }, ...DESIGN_AUDIT_CHECK_CODES.filter((code) => code !== "text_overflow").map((code) => ({ code, status: "pass" as const, reason: null, findings: [] }))], };
}

const RECORD = JSON.stringify({
  schema_version: 1,
  placements: [{
    id: "hero", purpose: "Hero photograph of a desk lamp", box: { width_px: 1200, height_px: 600 }, placement_mode: "cover", text_safe_region: null,
    references: [{ url: "https://example.test/lamp", licence: "CC0", local_file: REFERENCE, sha256: createHash("sha256").update(REFERENCE_BYTES).digest("hex") }],
    scale_facts: [], attachment_receipt: "yes",
    candidates: [{ id: "c1", file: "images/c1.png", rejected_reason: "Too wide" }, { id: "c2", file: "images/c2.png", rejected_reason: null }], chosen_candidate: "c2",
  }],
});

/** A real turn whose design review fails after the agent wrote a placement record into the stage. */
async function failedReviewTurnWithRecord(): Promise<string> {
  const turn = startUserTurn(sessionId, { type: "user.message", text: "Create a result", attachments: [] }, undefined, {
    detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture", version: "test" }] }),
    runAdapter: async (_backend, input) => {
      await writeFile(path.join(input.projectDir, "index.html"), "<!doctype html><p>Generated</p>");
      await mkdir(path.join(input.projectDir, ".meta", "references"), { recursive: true });
      await writeFile(path.join(input.projectDir, PHOTO_PLACEMENTS_FILE), RECORD);
      await writeFile(path.join(input.projectDir, REFERENCE), REFERENCE_BYTES);
      return { exitCode: 0 };
    },
    reviewDesign: async () => ({ status: "checked", repairs: 2, result: mustFix() }),
  } satisfies TurnDependencies);
  if (turn === null) throw new Error("turn reservation unavailable");
  await turn.promise;
  expect(getSqlite().prepare("SELECT status FROM artifact_operations WHERE id=?").get(turn.operationId)).toEqual({ status: "failed" });
  return turn.operationId;
}

test("Given a review-failed turn that wrote a placement record, When the draft is recovered, Then the draft carries the record and the original project does not", async () => {
  const operationId = await failedReviewTurnWithRecord();

  const recovered = await recoverReviewFailedDraft(getSqlite(), { projectId, operationId });
  createdDrafts.push(recovered.project_id);

  const draft = (await getProjectDetail(recovered.project_id))!;
  const draftDir = resolveManagedPath(projectsDir, draft.dir_path);
  expect((await readPhotoPlacements(draftDir)).kind).toBe("present");
  expect(await readFile(path.join(draftDir, REFERENCE))).toEqual(REFERENCE_BYTES);
  expect((await readPhotoPlacements(projectDir)).kind).toBe("absent");
});
