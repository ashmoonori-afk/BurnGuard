import { createHash, randomUUID } from "node:crypto";
import { constants, watch } from "node:fs";
import { lstat, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NormalizedEvent } from "@bg/shared";
import { assertSafeName, resolveWithin } from "../security/path-boundary";

type PreviewEvent = Extract<NormalizedEvent, { type: "artifact.preview" }>;
type Preview = { projectId: string; id: string; stageDir: string; entrypoint: string; version: number; forbiddenSha256: ReadonlySet<string> };
// Transient display only. ArtifactCoordinator remains the sole publication authority.
const previews = new Map<string, Preview>();
const WEB_ASSET = /\.(html?|css|m?js|svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i;

function assetPath(value: string): string[] {
  const parts = value.split("/");
  if (parts.length > 32 || !WEB_ASSET.test(value) || parts.some((part) => part.startsWith(".") || /^(docs|inputs-.*)$/i.test(part))) throw new Error("preview_path_invalid");
  return parts.map(assertSafeName);
}

export function startTurnPreview(input: Omit<Preview, "version">, publish: (event: PreviewEvent) => Promise<void>) {
  const preview: Preview = { ...input, version: 0 };
  previews.set(input.projectId, preview);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pending = Promise.resolve();
  const emit = (active: boolean) => {
    pending = pending.then(() => publish({ id: randomUUID(), ts: Date.now(), type: "artifact.preview", projectId: input.projectId, previewId: input.id, path: input.entrypoint, version: ++preview.version, active })).catch((error: unknown) => console.error("[preview] event failed", error instanceof Error ? error.name : "unknown"));
  };
  const watcher = watch(input.stageDir, { recursive: true }, (_event, name) => {
    try { if (name !== null) assetPath(name.toString().replaceAll("\\", "/")); }
    catch { return; }
    // Throttle, not debounce: continuous writing must still reach the screen.
    if (timer === undefined && !closed) timer = setTimeout(() => { timer = undefined; if (!closed) emit(true); }, 600);
  });
  watcher.on("error", () => { if (!closed) emit(false); });
  emit(true);
  return async () => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    watcher.close();
    if (previews.get(input.projectId) === preview) previews.delete(input.projectId);
    emit(false);
    await pending;
  };
}

export async function readTurnPreview(projectId: string, previewId: string, relativePath: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const preview = previews.get(projectId);
  if (!preview || preview.id !== previewId) return null;
  const parts = assetPath(relativePath);
  const target = path.join(preview.stageDir, ...parts);
  const verifyPath = async () => {
    let current = preview.stageDir;
    for (const part of ["", ...parts]) {
      current = path.join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink() || (current !== target && !info.isDirectory())) throw new Error("preview_path_invalid");
    }
    if (resolveWithin(preview.stageDir, ...parts) !== target) throw new Error("preview_path_invalid");
  };
  await verifyPath();
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 32 * 1024 * 1024) throw new Error("preview_file_invalid");
    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    await verifyPath();
    const current = await lstat(target);
    if (offset !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== current.ino || before.dev !== current.dev || after.nlink !== 1 || previews.get(projectId) !== preview) throw new Error("preview_file_changed");
    if (preview.forbiddenSha256.has(createHash("sha256").update(bytes).digest("hex"))) throw new Error("preview_private_source");
    return bytes;
  } finally { await handle.close(); }
}

export async function recordTurnPreview(projectId: string, previewId: string, value: unknown): Promise<boolean> {
  const preview = previews.get(projectId);
  if (!preview || preview.id !== previewId) return false;
  const keys = ["version", "width", "height", "images", "brokenImages", "pendingImages", "horizontalOverflow"] as const;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  if (Object.keys(report).length !== keys.length || keys.some((key) => typeof report[key] !== "number" || !Number.isSafeInteger(report[key]) || (report[key] as number) < 0 || (report[key] as number) > 1_000_000) || report.version !== preview.version || Number(report.brokenImages) + Number(report.pendingImages) > Number(report.images)) return false;
  const target = path.join(path.dirname(preview.stageDir), "preview-report.json");
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ schema_version: 1, source: "in_app_iframe_dom", scope: "current_page_only_not_screenshot_review", observed_at: Date.now(), path: preview.entrypoint, ...report }), { flag: "wx", mode: 0o600 });
    if (previews.get(projectId) !== preview) return false;
    await rename(temporary, target);
    return true;
  } finally { await rm(temporary, { force: true }); }
}
