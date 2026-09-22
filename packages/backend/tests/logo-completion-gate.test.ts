import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { DesignAuditResult, NormalizedEvent, TurnErrorCode, TurnRejectionReason } from "@bg/shared";
import { LOGO_ACTION_TAG, LOGO_SOURCE_ATTRIBUTE } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { listSequencedSessionEvents } from "../src/db/event-sequence-repository";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { broker } from "../src/services/broker";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { logoSvgContract } from "../src/services/logo-svg-validation";
import { interruptUserTurn, startUserTurn } from "../src/services/turns";

/**
 * The finalize completion gate and its one bounded repair
 * (doc/23-logo-design-deliverable-2026-09-18.md, D6).
 *
 * Every case runs a real turn through the artifact coordinator with an injected adapter, so the
 * assertions are about what the project directory and the session stream actually contain after
 * the transaction settles — not about what a mocked gate was asked.
 */

const PRIVATE_DIAGNOSTIC = "fixture-private-diagnostic /private/fixture/config.toml";
/** Synthetic brand fixture; no real project or user content appears in this repository. */
const BRAND = "하늘빛 스튜디오";
const SELECTED = "candidate-2";
const SELECTED_FILE = `explorations/round-1/${SELECTED}.png`;
const REQUEST = `Finalize the selected mark.\n<${LOGO_ACTION_TAG}>{"action":"select","round":1,"candidate_id":"${SELECTED}"}</${LOGO_ACTION_TAG}>`;
const INITIAL = "<!doctype html><section data-graphic-artboard><h1>Exploration sheet</h1></section>";
const GUIDELINES = `<!doctype html><html><body>${Array.from({ length: 9 }, (_, index) =>
  `<section data-graphic-artboard><h1>Guideline ${index + 1}</h1><p>${BRAND} usage rule ${index + 1}.</p></section>`).join("")}</body></html>`;

function logoSvg(extra = "", source = SELECTED_FILE): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${BRAND}"${extra} ${LOGO_SOURCE_ATTRIBUTE}="${source}"><path d="M0 0H512V512H0Z" fill="#101828"/></svg>`;
}
/** The reproduced defect class: an attribute the master vector allowlist does not admit. */
const BROKEN_SVG = logoSvg(' data-variant="primary"');
const VALID_SVG = logoSvg();

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
const ROUNDS = [{
  round: 1,
  candidates: images.map((_, index) => ({
    id: `candidate-${index + 1}`, file: `explorations/round-1/candidate-${index + 1}.png`,
    logo_type: "abstract", prompt: "fixture", rationale: "fixture",
  })),
}];
const manifestJson = (selected: unknown, rounds: unknown = ROUNDS): string =>
  JSON.stringify({ schema_version: 1, selected, rounds });

let projectId: string;
let sessionId: string;
let projectDir: string;

beforeAll(async () => { await runMigrations(); await mkdir(projectsDir, { recursive: true }); });
beforeEach(async () => {
  projectId = `logo-gate-${crypto.randomUUID()}`;
  sessionId = `${projectId}-session`;
  projectDir = path.join(projectsDir, projectId);
  await mkdir(path.join(projectDir, "explorations/round-1"), { recursive: true });
  await writeFile(path.join(projectDir, "index.html"), INITIAL);
  for (const [index, bytes] of images.entries()) await writeFile(path.join(projectDir, `explorations/round-1/candidate-${index + 1}.png`), bytes);
  await writeFile(path.join(projectDir, "explorations/manifest.json"), manifestJson(null));
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'logo',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
});
afterEach(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(projectDir, { recursive: true, force: true });
});

type Scenario =
  | "repair-success" | "repair-still-invalid" | "repair-exit" | "repair-error-event" | "repair-cancelled"
  | "repair-image-call" | "repair-mutated-candidate" | "repair-mutated-guidelines" | "repair-extra-file"
  | "source-mismatch" | "history-appended" | "candidate-mutated" | "selection-not-recorded" | "revision-conflict";

type Expected = {
  readonly code: TurnErrorCode | null;
  readonly reason: TurnRejectionReason | null;
  readonly repairs: number;
  readonly stopReason: "end_turn" | "error" | "interrupted";
};

const cases = [
  ["repair-success", { code: null, reason: null, repairs: 1, stopReason: "end_turn" }],
  ["repair-still-invalid", { code: "logo_deliverables_missing", reason: "logo_svg_invalid", repairs: 1, stopReason: "error" }],
  ["repair-exit", { code: "logo_deliverables_missing", reason: "logo_svg_invalid", repairs: 1, stopReason: "error" }],
  ["repair-error-event", { code: "logo_deliverables_missing", reason: "logo_svg_invalid", repairs: 1, stopReason: "error" }],
  ["repair-cancelled", { code: null, reason: null, repairs: 1, stopReason: "interrupted" }],
  ["repair-image-call", { code: "logo_deliverables_missing", reason: "logo_svg_invalid", repairs: 1, stopReason: "error" }],
  ["repair-mutated-candidate", { code: "logo_deliverables_missing", reason: "logo_history_changed", repairs: 1, stopReason: "error" }],
  // A repair that produces a valid vector and also edits something it was told to preserve is
  // still refused, with the refusal that opened the repair: the deliverable gate cannot see a
  // guidelines rewrite or a stray file, so the repair's own blast radius is what is checked.
  ["repair-mutated-guidelines", { code: "logo_deliverables_missing", reason: "logo_svg_invalid", repairs: 1, stopReason: "error" }],
  ["repair-extra-file", { code: "logo_deliverables_missing", reason: "logo_svg_invalid", repairs: 1, stopReason: "error" }],
  ["source-mismatch", { code: "logo_deliverables_missing", reason: "logo_svg_source_mismatch", repairs: 0, stopReason: "error" }],
  ["history-appended", { code: "logo_deliverables_missing", reason: "logo_history_changed", repairs: 0, stopReason: "error" }],
  ["candidate-mutated", { code: "logo_deliverables_missing", reason: "logo_history_changed", repairs: 0, stopReason: "error" }],
  ["selection-not-recorded", { code: "logo_deliverables_missing", reason: "logo_selection_invalid", repairs: 0, stopReason: "error" }],
  ["revision-conflict", { code: "operation_conflict", reason: null, repairs: 0, stopReason: "error" }],
] as const satisfies readonly (readonly [Scenario, Expected])[];

test.each(cases)("Given %s in a finalize logo turn Then the gate, the repair budget and the project tree agree", async (scenario, expected) => {
  const before = await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir);
  const events: NormalizedEvent[] = [];
  const unsubscribe = broker.subscribe(sessionId, event => { events.push(event); });
  let generations = 0, repairs = 0;
  let generationPrompt = "";
  try {
    const turn = startUserTurn(sessionId, { type: "user.message", text: REQUEST }, undefined, {
      detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "unused", version: "fixture", authenticated: true, image_generation: true }] }),
      runAdapter: async (_backend, input) => {
        if (input.turnId.endsWith("-logo-repair")) {
          repairs++;
          const contextMatch = /<burnguard-logo-repair-v1>\n([\s\S]*?)\n<\/burnguard-logo-repair-v1>/.exec(input.prompt);
          if (!contextMatch?.[1]) throw new Error("repair context missing");
          const context = JSON.parse(contextMatch[1]);
          expect(context).toEqual({
            schema_version: 1, task: "repair_completed_logo_deliverable", reason: "logo_svg_invalid",
            // The rule that was broken, and the rule itself — both read off the validator's tables.
            violation: "svg_forbidden_attribute", contract: logoSvgContract(),
            directory: input.projectDir, editable_paths: ["logo.svg"],
            preserve_paths: ["explorations", "explorations/manifest.json", "index.html"],
            image_generation: "forbidden",
          });
          // The contract is the enforced allowlist, not a restatement of it.
          expect(context.contract.attributes).toContain("aria-label");
          expect(context.contract.elements).toContain("path");
          expect(context.contract.text_elements).toEqual(["desc", "title"]);
          // The offending attribute is model-authored text; only the finite head may be echoed.
          expect(JSON.stringify(context)).not.toContain("data-variant");
          // Forbidding image generation is a capability of the run, not a sentence in the prompt.
          expect(input.imageGeneration).toBe("forbidden");
          // A repair is an edit of the saved stage, never a replay of the creation request.
          expect(input.prompt).not.toContain(generationPrompt);
          expect(input.prompt).not.toContain("<burnguard-logo-output-v1>");
          expect(input.userEvent).toEqual({ type: "user.message", text: input.prompt });
          if (scenario === "repair-cancelled") interruptUserTurn(sessionId);
          if (scenario !== "repair-still-invalid") await writeFile(path.join(input.projectDir, "logo.svg"), VALID_SVG);
          if (scenario === "repair-mutated-candidate") await writeFile(path.join(input.projectDir, SELECTED_FILE), png(9));
          // Valid vector, but the repair also rewrote a preserve_paths file the gate cannot judge.
          if (scenario === "repair-mutated-guidelines") await writeFile(path.join(input.projectDir, "index.html"), `${GUIDELINES}<!-- repaired -->`);
          if (scenario === "repair-extra-file") await writeFile(path.join(input.projectDir, "repair-notes.md"), "# left behind by the repair\n");
          if (scenario === "repair-image-call") {
            // A repair that reaches for the image tool anyway is refused whatever it then wrote.
            const imageCallId = crypto.randomUUID();
            await input.onEvent({ id: crypto.randomUUID(), ts: 5, type: "tool.started", turnId: input.turnId, toolCallId: imageCallId, tool: "image_generation", input: {} });
            await input.onEvent({ id: crypto.randomUUID(), ts: 5, type: "tool.finished", turnId: input.turnId, toolCallId: imageCallId, tool: "image_generation", ok: true, output: {} });
          }
          if (scenario === "repair-error-event") await input.onEvent({ id: crypto.randomUUID(), ts: 5, type: "status.error", code: "turn_failed", message: PRIVATE_DIAGNOSTIC, recoverable: true });
          await input.onEvent({ id: crypto.randomUUID(), ts: 5, type: "chat.message_end", turnId: input.turnId });
          await input.onEvent({ id: crypto.randomUUID(), ts: 6, type: "status.idle", stopReason: "end_turn" });
          return { exitCode: scenario === "repair-exit" ? 1 : 0 };
        }
        generations++;
        generationPrompt = input.prompt;
        await writeFile(path.join(input.projectDir, "index.html"), GUIDELINES);
        await writeFile(path.join(input.projectDir, "logo.svg"),
          scenario === "source-mismatch" ? logoSvg("", "explorations/round-1/candidate-1.png")
            : scenario.startsWith("repair-") ? BROKEN_SVG : VALID_SVG);
        if (scenario === "candidate-mutated") await writeFile(path.join(input.projectDir, SELECTED_FILE), png(9));
        await writeFile(path.join(input.projectDir, "explorations/manifest.json"), manifestJson(
          scenario === "selection-not-recorded" ? null : { round: 1, candidate_id: SELECTED },
          scenario === "history-appended"
            ? [...ROUNDS, { round: 2, candidates: Array.from({ length: 4 }, (_, index) => ({ id: `candidate-${index + 1}`, file: `explorations/round-2/candidate-${index + 1}.png`, logo_type: "abstract", prompt: "fixture", rationale: "fixture" })) }]
            : ROUNDS));
        if (scenario === "revision-conflict") getSqlite().prepare("UPDATE projects SET current_revision=current_revision+1 WHERE id=?").run(projectId);
        await input.onEvent({ id: crypto.randomUUID(), ts: 3, type: "chat.message_end", turnId: input.turnId });
        await input.onEvent({ id: crypto.randomUUID(), ts: 4, type: "status.idle", stopReason: "end_turn" });
        return { exitCode: 0 };
      },
      reviewDesign: async (input): Promise<{ status: "checked"; repairs: number; result: DesignAuditResult }> => ({
        status: "checked", repairs: 0,
        result: { schema_version: 1, project_id: input.projectId, artifact_revision: input.revision, artifact_digest: before.tree_digest, created_at: 1, overall_status: "ready", checks: [] },
      }),
    });
    if (turn === null) throw new Error("turn reservation unavailable");
    await Promise.all([turn.prepared, turn.promise]);

    expect(generations).toBe(1);
    // At most one bounded repair, ever: a second refusal is final.
    expect(repairs).toBe(expected.repairs);
    expect(events.filter(event => event.type === "tool.finished" && event.tool === "generation_logo_repair")).toHaveLength(expected.repairs);
    // No image is generated anywhere in a finalize turn, and a repair's image call is neither
    // honoured nor shown: the session stream carries no image tool call at all.
    expect(events.filter(event => (event.type === "tool.started" || event.type === "tool.finished") && event.tool === "image_generation")).toHaveLength(0);

    const errors = events.filter(event => event.type === "status.error");
    expect(errors.map(event => event.code)).toEqual(expected.code === null ? [] : [expected.code]);
    expect(errors.map(event => event.reason ?? null)).toEqual(expected.code === null ? [] : [expected.reason]);
    expect(errors.map(event => event.notApplied ?? null)).toEqual(expected.code === null ? []
      : [{ turnId: turn.turnId, operationId: turn.operationId, repairs: expected.repairs }]);

    // Exactly one terminal status, and never a success terminal for a refused turn.
    expect(events.filter(event => event.type === "status.idle").map(event => event.stopReason)).toEqual([expected.stopReason]);
    // The repair's own end-of-message belongs to the repair, not to the turn; a refused or
    // interrupted turn never releases the buffered terminal events at all.
    expect(events.filter(event => event.type === "chat.message_end")).toHaveLength(expected.stopReason === "end_turn" ? 1 : 0);

    const replay = listSequencedSessionEvents(getSqlite(), sessionId, 0).map(item => item.event);
    expect(replay.filter(event => event.type === "status.error")).toEqual(errors);
    expect(JSON.stringify({ events, replay })).not.toContain(PRIVATE_DIAGNOSTIC);
    // The private detail names a candidate or a manifest field; only the finite reason may ship.
    expect(JSON.stringify(errors)).not.toContain("svg_forbidden_attribute");
    expect(JSON.stringify(errors)).not.toContain("data-variant");

    const committed = expected.stopReason !== "error";
    expect(getSqlite().prepare("SELECT status FROM artifact_operations WHERE id=?").get(turn.operationId)).toEqual({ status: committed ? "committed" : "failed" });

    // The selection is authoritative and immutable: a repair cannot change which bytes were chosen.
    for (const [index, bytes] of images.entries()) {
      const candidate = path.join(projectDir, `explorations/round-1/candidate-${index + 1}.png`);
      const expectedBytes = !committed || scenario !== "candidate-mutated" || index !== 1 ? bytes : png(9);
      expect(createHash("sha256").update(await readFile(candidate)).digest("hex"))
        .toBe(createHash("sha256").update(expectedBytes).digest("hex"));
    }

    if (expected.stopReason === "error") {
      expect(await inspectCanonicalTree(projectDir)).toEqual(before);
      expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe(INITIAL);
    }
    if (scenario === "repair-success") {
      expect(await readFile(path.join(projectDir, "logo.svg"), "utf8")).toBe(VALID_SVG);
      expect(JSON.parse(await readFile(path.join(projectDir, "explorations/manifest.json"), "utf8")).selected)
        .toEqual({ round: 1, candidate_id: SELECTED });
    }
  } finally {
    unsubscribe();
    interruptUserTurn(sessionId);
  }
});

test("Given a failure after the operation committed Then the refusal never claims the project is unchanged", async () => {
  const before = await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir);
  const events: NormalizedEvent[] = [];
  const unsubscribe = broker.subscribe(sessionId, event => { events.push(event); });
  // The shipped QA barrier, scoped to this operation id: it throws once publication is terminal,
  // which is the only way to reach a post-commit failure without a real disk or database fault.
  const operationId = `gate-after-publish-${crypto.randomUUID()}`;
  const previous = {
    qa: process.env.BG_ARTIFACT_QA,
    operation: process.env.BG_ARTIFACT_TURN_OPERATION_ID,
    barrier: process.env.BG_ARTIFACT_TURN_BARRIER,
  };
  process.env.BG_ARTIFACT_QA = "1";
  process.env.BG_ARTIFACT_TURN_OPERATION_ID = operationId;
  process.env.BG_ARTIFACT_TURN_BARRIER = "after_publish";
  try {
    const turn = startUserTurn(sessionId, { type: "user.message", text: REQUEST }, operationId, {
      detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "unused", version: "fixture", authenticated: true, image_generation: true }] }),
      runAdapter: async (_backend, input) => {
        await writeFile(path.join(input.projectDir, "index.html"), GUIDELINES);
        await writeFile(path.join(input.projectDir, "logo.svg"), VALID_SVG);
        await writeFile(path.join(input.projectDir, "explorations/manifest.json"), manifestJson({ round: 1, candidate_id: SELECTED }));
        await input.onEvent({ id: crypto.randomUUID(), ts: 3, type: "chat.message_end", turnId: input.turnId });
        await input.onEvent({ id: crypto.randomUUID(), ts: 4, type: "status.idle", stopReason: "end_turn" });
        return { exitCode: 0 };
      },
      reviewDesign: async (input): Promise<{ status: "checked"; repairs: number; result: DesignAuditResult }> => ({
        status: "checked", repairs: 0,
        result: { schema_version: 1, project_id: input.projectId, artifact_revision: input.revision, artifact_digest: before.tree_digest, created_at: 1, overall_status: "ready", checks: [] },
      }),
    });
    if (turn === null) throw new Error("turn reservation unavailable");
    expect(turn.operationId).toBe(operationId);
    await Promise.all([turn.prepared, turn.promise]);

    // The turn is reported as failed, because a step after publication did fail.
    const errors = events.filter(event => event.type === "status.error");
    expect(errors).toHaveLength(1);
    expect(events.filter(event => event.type === "status.idle").map(event => event.stopReason)).toEqual(["error"]);
    // But its work is in the project, so no not-applied notice and no rejection reason is attached.
    expect(errors.map(event => event.notApplied ?? null)).toEqual([null]);
    expect(errors.map(event => event.reason ?? null)).toEqual([null]);
    expect(getSqlite().prepare("SELECT status FROM artifact_operations WHERE id=?").get(operationId)).toEqual({ status: "committed" });
    expect(await readFile(path.join(projectDir, "logo.svg"), "utf8")).toBe(VALID_SVG);
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe(GUIDELINES);
    expect((await inspectCanonicalTree(projectDir)).tree_digest).not.toBe(before.tree_digest);
    // The durable replay tells the reloaded client the same thing the live stream did.
    expect(listSequencedSessionEvents(getSqlite(), sessionId, 0).map(item => item.event).filter(event => event.type === "status.error")).toEqual(errors);
  } finally {
    if (previous.qa === undefined) delete process.env.BG_ARTIFACT_QA; else process.env.BG_ARTIFACT_QA = previous.qa;
    if (previous.operation === undefined) delete process.env.BG_ARTIFACT_TURN_OPERATION_ID; else process.env.BG_ARTIFACT_TURN_OPERATION_ID = previous.operation;
    if (previous.barrier === undefined) delete process.env.BG_ARTIFACT_TURN_BARRIER; else process.env.BG_ARTIFACT_TURN_BARRIER = previous.barrier;
    unsubscribe();
    interruptUserTurn(sessionId);
  }
});

test("Given a nonrepairable provenance failure in an explore turn Then no repair is attempted and the reason names provenance", async () => {
  const before = await new ArtifactCoordinator(getSqlite()).initialize(projectId, projectDir);
  const events: NormalizedEvent[] = [];
  const unsubscribe = broker.subscribe(sessionId, event => { events.push(event); });
  let repairs = 0;
  try {
    const turn = startUserTurn(sessionId, { type: "user.message", text: "Explore more concepts" }, undefined, {
      detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "unused", version: "fixture", authenticated: true, image_generation: true }] }),
      runAdapter: async (_backend, input) => {
        if (input.turnId.endsWith("-logo-repair")) { repairs++; return { exitCode: 0 }; }
        await writeFile(path.join(input.projectDir, "index.html"), GUIDELINES);
        await mkdir(path.join(input.projectDir, "explorations/round-2"), { recursive: true });
        // A second round whose bytes the image tool never reported: unprovenanced, not repairable.
        for (let index = 0; index < 4; index++) await writeFile(path.join(input.projectDir, `explorations/round-2/candidate-${index + 1}.png`), png(20 + index));
        await writeFile(path.join(input.projectDir, "explorations/manifest.json"), manifestJson(null, [...ROUNDS, {
          round: 2,
          candidates: Array.from({ length: 4 }, (_, index) => ({ id: `candidate-${index + 1}`, file: `explorations/round-2/candidate-${index + 1}.png`, logo_type: "abstract", prompt: "fixture", rationale: "fixture" })),
        }]));
        const toolCallId = crypto.randomUUID();
        await input.onEvent({ id: crypto.randomUUID(), ts: 2, type: "tool.started", turnId: input.turnId, toolCallId, tool: "image_generation", input: {} });
        await input.onEvent({ id: crypto.randomUUID(), ts: 3, type: "tool.finished", turnId: input.turnId, toolCallId, tool: "image_generation", ok: true, output: {} });
        await input.onEvent({ id: crypto.randomUUID(), ts: 4, type: "status.idle", stopReason: "end_turn" });
        return { exitCode: 0 };
      },
      reviewDesign: async (input): Promise<{ status: "checked"; repairs: number; result: DesignAuditResult }> => ({
        status: "checked", repairs: 0,
        result: { schema_version: 1, project_id: input.projectId, artifact_revision: input.revision, artifact_digest: before.tree_digest, created_at: 1, overall_status: "ready", checks: [] },
      }),
    });
    if (turn === null) throw new Error("turn reservation unavailable");
    await Promise.all([turn.prepared, turn.promise]);

    expect(repairs).toBe(0);
    const errors = events.filter(event => event.type === "status.error");
    expect(errors.map(event => event.code)).toEqual(["logo_image_provenance_missing"]);
    expect(errors.map(event => event.reason)).toEqual(["logo_candidate_provenance"]);
    expect(errors.map(event => event.notApplied)).toEqual([{ turnId: turn.turnId, operationId: turn.operationId, repairs: 0 }]);
    expect(events.filter(event => event.type === "status.idle").map(event => event.stopReason)).toEqual(["error"]);
    expect(JSON.stringify(errors)).not.toContain("candidate_unprovenanced");
    expect(await inspectCanonicalTree(projectDir)).toEqual(before);
  } finally {
    unsubscribe();
    interruptUserTurn(sessionId);
  }
});
