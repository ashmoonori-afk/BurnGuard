import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { DesignAuditResult, NormalizedEvent, TurnErrorCode } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { listSequencedSessionEvents } from "../src/db/event-sequence-repository";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { broker } from "../src/services/broker";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { RenderSessionError } from "../src/services/export-render-session";
import { reviewTurnDesign } from "../src/services/turn-design-review";
import { startUserTurn } from "../src/services/turns";

const PRIVATE_DIAGNOSTIC = "fixture-private-diagnostic /private/fixture/config.toml";
const INITIAL = "<!doctype html><p>Previous logo sheet</p>";
let projectId: string;
let sessionId: string;
let projectDir: string;

beforeAll(async () => { await runMigrations(); await mkdir(projectsDir, { recursive: true }); });
beforeEach(async () => {
  projectId = `logo-errors-${crypto.randomUUID()}`;
  sessionId = `${projectId}-session`;
  projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir);
  await writeFile(path.join(projectDir, "index.html"), INITIAL);
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'logo',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
});
afterEach(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(projectDir, { recursive: true, force: true });
});

// Decodable square PNGs with distinct pixels, not header-only or timing-dependent fixtures.
function png(seed: number): Buffer {
  const size = 256, raw = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw[y * (size + 1) + 1 + x] = (x * 7 + y * 3 + seed) & 255;
  const chunk = (name: string, data: Buffer): Buffer => {
    const typed = Buffer.concat([Buffer.from(name), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const images = [1, 2, 3, 4].map(png);
const hashes = images.map(bytes => createHash("sha256").update(bytes).digest("hex"));

const cases = [
  ["audit-timeout", "design_review_failed"],
  ["audit-unavailable", "design_review_failed"],
  ["must-fix", "design_review_failed"],
  ["repair-exit", "design_review_failed"],
  ["repair-error-event", "design_review_failed"],
  ["repair-idle-error", "design_review_failed"],
  ["repair-throw", "design_review_failed"],
  ["repair-timeout", "design_review_failed"],
  ["provenance-missing", "logo_image_provenance_missing"],
  ["provenance-unmatched", "logo_image_provenance_missing"],
  ["manifest-missing", "logo_deliverables_missing"],
  ["generation-error", "turn_failed"],
  ["repair-success", null],
  ["repair-contrast", null],
] as const satisfies readonly (readonly [string, TurnErrorCode | null])[];

test.each(cases)("Given %s in a logo turn When finalized Then its stage is preserved through live events and replay", async (scenario, expectedCode) => {
  const before = await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir);
  const events: NormalizedEvent[] = [];
  const unsubscribe = broker.subscribe(sessionId, event => { events.push(event); });
  let generations = 0, repairs = 0, audits = 0;
  let generationPrompt = "";
  let manifestHashBeforeRepair = "";
  try {
    const turn = startUserTurn(sessionId, { type: "user.message", text: "Create logo concepts" }, undefined, {
      detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "unused", version: "fixture", authenticated: true, image_generation: true }] }),
      runAdapter: async (_backend, input) => {
        if (input.turnId.includes("-design-repair-")) {
          repairs++;
          const contextMatch = /<burnguard-design-repair-v1>\n([\s\S]*?)\n<\/burnguard-design-repair-v1>/.exec(input.prompt);
          const findingsMatch = /<design_review_findings>\n([\s\S]*?)\n<\/design_review_findings>/.exec(input.prompt);
          if (!contextMatch?.[1] || !findingsMatch?.[1]) throw new Error("repair context missing");
          const context: unknown = JSON.parse(contextMatch[1]);
          const targets: unknown = JSON.parse(findingsMatch[1]);
          expect(context).toEqual({ schema_version: 1, task: "repair_existing_artifact", project_type: "logo", directory: input.projectDir, entrypoint: "index.html", scope: scenario === "repair-contrast" ? "contrast_only" : "targeted_findings", image_generation: scenario === "repair-contrast" ? "forbidden" : "not_requested", preserve_paths: scenario === "repair-contrast" ? ["explorations"] : [] });
          expect(input.prompt).not.toContain(generationPrompt);
          expect(input.prompt).not.toContain("<burnguard-logo-output-v1>");
          expect(input.prompt).not.toContain("LOGO_IMAGE_GENERATION_REQUIRED");
          expect(input.userEvent).toEqual({ type: "user.message", text: input.prompt });
          if (scenario === "repair-contrast") {
            expect(targets).toEqual([{ code: "contrast", source: { rel_path: "index.html", node_bg_id: "fixture" }, action: "increase_color_contrast", measured: 4.48, threshold: 4.5 }]);
            const file = path.join(input.projectDir, "index.html");
            const html = await readFile(file, "utf8");
            await writeFile(file, html.replace("--ink:#777777", "--ink:#333333"));
          }
          if (scenario === "repair-throw") throw new Error(PRIVATE_DIAGNOSTIC);
          if (scenario === "repair-timeout") throw new DOMException(PRIVATE_DIAGNOSTIC, "TimeoutError");
          if (scenario === "repair-error-event") await input.onEvent({ id: crypto.randomUUID(), ts: 2, type: "status.error", code: "turn_failed", message: PRIVATE_DIAGNOSTIC, recoverable: true });
          await input.onEvent({ id: crypto.randomUUID(), ts: 2, type: "status.idle", stopReason: scenario === "repair-idle-error" ? "error" : "end_turn" });
          return { exitCode: scenario === "repair-exit" ? 1 : 0 };
        }
        generations++;
        generationPrompt = input.prompt;
        if (scenario === "generation-error") {
          await input.onEvent({ id: crypto.randomUUID(), ts: 2, type: "status.error", code: "turn_failed", message: PRIVATE_DIAGNOSTIC, recoverable: false });
          return { exitCode: 1 };
        }
        await writeFile(path.join(input.projectDir, "index.html"), `<!doctype html>${scenario === "repair-contrast" ? "<style>:root{--ink:#777777}h1{color:var(--ink);background:#ffffff}</style>" : ""}<section data-graphic-artboard><h1>Updated concepts</h1></section>`);
        if (scenario !== "manifest-missing") {
          await mkdir(path.join(input.projectDir, "explorations/round-1"), { recursive: true });
          for (const [i, bytes] of images.entries()) await writeFile(path.join(input.projectDir, `explorations/round-1/candidate-${i + 1}.png`), bytes);
          await writeFile(path.join(input.projectDir, "explorations/manifest.json"), JSON.stringify({ schema_version: 1, selected: null, rounds: [{ round: 1, candidates: images.map((_, i) => ({ id: `candidate-${i + 1}`, file: `explorations/round-1/candidate-${i + 1}.png`, logo_type: "abstract", prompt: "fixture", rationale: "fixture" })) }] }));
        }
        if (scenario === "repair-contrast") manifestHashBeforeRepair = createHash("sha256").update(await readFile(path.join(input.projectDir, "explorations/manifest.json"))).digest("hex");
        // All files predate tool starts, so only explicitly reported hashes can prove origin.
        const count = scenario === "provenance-missing" ? 0 : scenario === "provenance-unmatched" ? 3 : 4;
        for (let i = 0; i < count; i++) {
          const toolCallId = `image-${i}`;
          await input.onEvent({ id: crypto.randomUUID(), ts: 2, type: "tool.started", turnId: input.turnId, toolCallId, tool: "image_generation", input: {} });
          await input.onEvent({ id: crypto.randomUUID(), ts: 3, type: "tool.finished", turnId: input.turnId, toolCallId, tool: "image_generation", ok: true, output: { image_sha256: [hashes[i]] } });
        }
        await input.onEvent({ id: crypto.randomUUID(), ts: 4, type: "status.idle", stopReason: "end_turn" });
        return { exitCode: 0 };
      },
      reviewDesign: input => reviewTurnDesign({ ...input, audit: async (): Promise<DesignAuditResult> => {
        audits++;
        if (scenario === "audit-timeout") throw new DOMException(PRIVATE_DIAGNOSTIC, "TimeoutError");
        if (scenario === "audit-unavailable") throw new RenderSessionError("chromium_not_installed", PRIVATE_DIAGNOSTIC);
        if (scenario === "repair-contrast") {
          const html = await readFile(path.join(input.adapter.projectDir, "index.html"), "utf8");
          const blocked = html.includes("--ink:#777777");
          return { schema_version: 1, project_id: projectId, artifact_revision: 1, artifact_digest: before.tree_digest, created_at: 1, overall_status: blocked ? "must_fix" : "ready", checks: blocked ? [{ code: "contrast", status: "fail", reason: null, findings: [{ id: "fixture", check_code: "contrast", severity: "must_fix", source: { rel_path: "index.html", node_bg_id: "fixture" }, evidence: "fixture", targeted_action: "increase_color_contrast", measured: 4.48, threshold: 4.5 }] }] : [] };
        }
        const blocked = scenario === "must-fix" || (scenario.startsWith("repair-") && repairs === 0);
        return { schema_version: 1, project_id: projectId, artifact_revision: 1, artifact_digest: before.tree_digest, created_at: 1, overall_status: blocked ? "must_fix" : "ready", checks: blocked ? [{ code: "text_overflow", status: "fail", reason: null, findings: [{ id: "fixture", check_code: "text_overflow", severity: "must_fix", source: { rel_path: "index.html", node_bg_id: "fixture" }, evidence: "fixture", targeted_action: "expand_or_reflow_text" }] }] : [] };
      } }),
    });
    if (turn === null) throw new Error("turn reservation unavailable");
    await Promise.all([turn.prepared, turn.promise]);
    expect(generations).toBe(1);
    expect(repairs).toBe(scenario === "must-fix" ? 2 : scenario.startsWith("repair-") ? 1 : 0);
    expect(audits).toBe(scenario === "generation-error" ? 0 : scenario === "must-fix" ? 3 : scenario === "repair-success" || scenario === "repair-contrast" ? 2 : 1);
    const errors = events.filter(event => event.type === "status.error");
    expect(errors.map(event => event.code)).toEqual(expectedCode === null ? [] : [expectedCode]);
    expect(events.filter(event => event.type === "status.idle").map(event => event.stopReason)).toEqual([expectedCode === null ? "end_turn" : "error"]);
    const replay = listSequencedSessionEvents(getSqlite(), sessionId, 0).map(item => item.event);
    expect(replay.filter(event => event.type === "status.error")).toEqual(errors);
    expect(JSON.stringify({ events, replay })).not.toContain(PRIVATE_DIAGNOSTIC);
    expect(JSON.stringify(errors)).not.toContain("candidate_unprovenanced");
    expect(getSqlite().prepare("SELECT status FROM artifact_operations WHERE id=?").get(turn.operationId)).toEqual({ status: expectedCode === null ? "committed" : "failed" });
    if (scenario === "repair-contrast") {
      expect(createHash("sha256").update(await readFile(path.join(projectDir, "explorations/manifest.json"))).digest("hex")).toBe(manifestHashBeforeRepair);
      for (const [index, bytes] of images.entries()) expect((await readFile(path.join(projectDir, `explorations/round-1/candidate-${index + 1}.png`))).equals(bytes)).toBe(true);
      expect(events.filter(event => event.type === "tool.finished" && event.tool === "image_generation")).toHaveLength(4);
      expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toContain("--ink:#333333");
    }
    if (expectedCode !== null) {
      expect(await inspectCanonicalTree(projectDir)).toEqual(before);
      expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe(INITIAL);
    }
  } finally { unsubscribe(); }
});

test("Given parent cancellation during a repair When review settles Then cancellation retains its original reason", async () => {
  const controller = new AbortController();
  const reason = new DOMException("fixture cancellation", "AbortError");
  const events: NormalizedEvent[] = [];
  const review = reviewTurnDesign({ projectId, type: "logo", entrypoint: "index.html", revision: 1,
    adapter: { sessionId, turnId: "cancel-review", projectDir, binaryPath: "unused", prompt: "fixture", userEvent: { type: "user.message", text: "fixture" }, signal: controller.signal, onEvent: async event => { events.push(event); } },
    audit: async () => ({ schema_version: 1, project_id: projectId, artifact_revision: 1, artifact_digest: "a".repeat(64), created_at: 1, overall_status: "must_fix", checks: [{ code: "text_overflow", status: "fail", reason: null, findings: [{ id: "fixture", check_code: "text_overflow", severity: "must_fix", source: { rel_path: "index.html", node_bg_id: "fixture" }, evidence: "fixture", targeted_action: "expand_or_reflow_text" }] }] }),
    run: async () => { controller.abort(reason); throw reason; },
  });
  await expect(review).rejects.toBe(reason);
  expect(events.filter(event => event.type === "status.error")).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: "tool.finished", ok: false });
});
