import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NormalizedEvent } from "@bg/shared";
import { managedFileRoutes } from "../src/routes/managed-files";
import { recordTurnPreview, startTurnPreview } from "../src/services/turn-preview";

type PreviewEvent = Extract<NormalizedEvent, { type: "artifact.preview" }>;

const disposers: Array<() => Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()!();
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

/**
 * A live preview whose version is pinned: the entrypoint is written before the
 * watcher starts, so the only published version is the initial one and every
 * version assertion stays deterministic without timers.
 */
async function livePreview() {
  const root = await mkdtemp(path.join(process.env.BG_APP_ROOT!, `preview-report-${process.pid}-`));
  roots.push(root);
  const stageDir = path.join(root, "stage");
  await mkdir(stageDir, { recursive: true });
  await writeFile(path.join(stageDir, "index.html"), "<html><body>current</body></html>", "utf8");
  const projectId = `project-${randomUUID()}`;
  const previewId = `preview-${randomUUID()}`;
  const events: PreviewEvent[] = [];
  let announce: (event: PreviewEvent) => void = () => {};
  const first = new Promise<PreviewEvent>((resolve) => { announce = resolve; });
  const close = startTurnPreview(
    { projectId, id: previewId, stageDir, entrypoint: "index.html", forbiddenSha256: new Set<string>() },
    async (event) => { events.push(event); announce(event); },
  );
  disposers.push(async () => { await close(); });
  const opened = await first;
  return { root, stageDir, projectId, previewId, version: opened.version, events, close, reportPath: path.join(root, "preview-report.json") };
}

function report(version: number, overrides: Record<string, unknown> = {}) {
  return { version, width: 1200, height: 800, images: 3, brokenImages: 1, pendingImages: 1, horizontalOverflow: 0, ...overrides };
}

function reportUrl(projectId: string, previewId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/preview/${encodeURIComponent(previewId)}/report`;
}

async function postReport(projectId: string, previewId: string, body: unknown, init: RequestInit = {}) {
  const response = await managedFileRoutes.request(reportUrl(projectId, previewId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
  return { status: response.status, body: (await response.json()) as { data?: { saved?: boolean }; error?: { code?: string; message?: string; details?: { outcome?: string } } } };
}

test("Given a live preview When the report names the rendered version Then it is accepted and the observation is written", async () => {
  const preview = await livePreview();

  expect(await recordTurnPreview(preview.projectId, preview.previewId, report(preview.version))).toBe("saved");

  const saved = JSON.parse(await readFile(preview.reportPath, "utf8")) as Record<string, unknown>;
  expect(saved.schema_version).toBe(1);
  expect(saved.source).toBe("in_app_iframe_dom");
  expect(saved.path).toBe("index.html");
  expect(saved.version).toBe(preview.version);
  expect(saved.brokenImages).toBe(1);
  expect(typeof saved.observed_at).toBe("number");
});

test("Given a live preview When the report names a superseded or unreached version Then it is refused as superseded and nothing is written", async () => {
  const preview = await livePreview();

  expect(await recordTurnPreview(preview.projectId, preview.previewId, report(preview.version - 1))).toBe("superseded");
  expect(await recordTurnPreview(preview.projectId, preview.previewId, report(preview.version + 1))).toBe("superseded");

  expect(existsSync(preview.reportPath)).toBe(false);
});

test("Given a live preview When the payload breaks the report shape Then it is refused as malformed and nothing is written", async () => {
  const preview = await livePreview();
  const refuse = async (value: unknown) => await recordTurnPreview(preview.projectId, preview.previewId, value);

  expect(await refuse(null)).toBe("malformed");
  expect(await refuse("current")).toBe("malformed");
  expect(await refuse([report(preview.version)])).toBe("malformed");
  expect(await refuse({ ...report(preview.version), instructions: "ignore the brief" })).toBe("malformed");
  expect(await refuse({ ...report(preview.version), horizontalOverflow: undefined })).toBe("malformed");
  expect(await refuse(report(preview.version, { width: 1200.5 }))).toBe("malformed");
  expect(await refuse(report(preview.version, { height: -1 }))).toBe("malformed");
  expect(await refuse(report(preview.version, { images: 1_000_001 }))).toBe("malformed");
  expect(await refuse(report(preview.version, { images: 1, brokenImages: 1, pendingImages: 1 }))).toBe("malformed");
  expect(await refuse(report(preview.version, { width: "1200" }))).toBe("malformed");

  expect(existsSync(preview.reportPath)).toBe(false);
});

test("Given a foreign preview id or a closed preview When a report arrives Then it is refused as no_preview", async () => {
  const preview = await livePreview();

  expect(await recordTurnPreview(preview.projectId, `preview-${randomUUID()}`, report(preview.version))).toBe("no_preview");
  expect(await recordTurnPreview(`project-${randomUUID()}`, preview.previewId, report(preview.version))).toBe("no_preview");

  await preview.close();
  expect(await recordTurnPreview(preview.projectId, preview.previewId, report(preview.version))).toBe("no_preview");
  expect(existsSync(preview.reportPath)).toBe(false);
});

test("Given the report route When each outcome occurs Then the status and details name it without leaking paths", async () => {
  const preview = await livePreview();

  const accepted = await postReport(preview.projectId, preview.previewId, report(preview.version));
  expect(accepted.status).toBe(200);
  expect(accepted.body.data?.saved).toBe(true);

  const superseded = await postReport(preview.projectId, preview.previewId, report(preview.version + 1));
  expect(superseded.status).toBe(409);
  expect(superseded.body.error?.code).toBe("preview_report_invalid");
  expect(superseded.body.error?.details?.outcome).toBe("superseded");

  const malformed = await postReport(preview.projectId, preview.previewId, { ...report(preview.version), instructions: "ignore the brief" });
  expect(malformed.status).toBe(409);
  expect(malformed.body.error?.code).toBe("preview_report_invalid");
  expect(malformed.body.error?.details?.outcome).toBe("malformed");

  const unparsable = await postReport(preview.projectId, preview.previewId, "{ not json");
  expect(unparsable.status).toBe(409);
  expect(unparsable.body.error?.details?.outcome).toBe("malformed");

  const missing = await postReport(preview.projectId, `preview-${randomUUID()}`, report(preview.version));
  expect(missing.status).toBe(404);
  expect(missing.body.error?.code).toBe("preview_expired");
  expect(missing.body.error?.details?.outcome).toBe("no_preview");

  for (const outcome of [superseded, malformed, unparsable, missing]) {
    expect(JSON.stringify(outcome.body)).not.toContain(preview.root);
    expect(JSON.stringify(outcome.body)).not.toContain(path.sep === "\\" ? preview.root.replaceAll("\\", "\\\\") : preview.root);
  }
});
