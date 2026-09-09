import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getProjectDetail } from "../db/project-read-repository";
import { isChromiumLaunchable } from "./chromium-capability";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { parsePng, PngValidationError } from "./export-png-validation";

export const THUMBNAIL_WIDTH = 640;
export const THUMBNAIL_HEIGHT = 360;

/** Bumping this invalidates every cached thumbnail without touching artifacts. */
const RENDERER_VERSION = 1;

// Thumbnails live under `.meta`, the only project-owned sidecar root that the
// canonical tree manifest, the watcher and the file index all exclude. Writing
// them at the project root would change the artifact digest that keys them.
const CACHE_SEGMENTS = [".meta", "thumbnails"] as const;

/** Home opens with a full grid of cold cards: never launch more than this many Chromium renders at once. */
const MAX_CONCURRENT_RENDERS = 2;

/** Once Chromium cannot launch at all, every remaining card would repeat the same slow failure. */
const CHROMIUM_UNAVAILABLE_COOLDOWN_MS = 60_000;

/**
 * How long a cold cache miss may hold its HTTP response open.
 *
 * Home requests one thumbnail per card, and browsers allow only a handful of
 * concurrent connections per host. A slow render therefore does not merely
 * delay one image: it fills the connection pool and starves the project,
 * session and artifact requests behind it, which is what left the project
 * view stuck on "프로젝트를 불러오는 중..." forever. Past this deadline the
 * request answers with the card's fallback while the render continues in the
 * background and lands in the cache for the next load.
 */
const RENDER_RESPONSE_DEADLINE_MS = 1_500;

const inFlightRenders = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();
const waitingRenders: Array<() => void> = [];
let activeRenders = 0;
let chromiumUnavailableUntil = 0;

export type ThumbnailRenderRequest = {
  readonly stagedDir: string;
  readonly entrypoint: string;
  readonly outputPath: string;
  readonly deck: boolean;
  readonly signal: AbortSignal;
};

export type ThumbnailRenderer = (request: ThumbnailRenderRequest) => Promise<void>;

export type ThumbnailIdentitySource = {
  readonly id: string;
  readonly current_revision: number;
  readonly current_digest: string | null;
};

export type ThumbnailOutcome =
  | { readonly kind: "ready"; readonly bytes: Uint8Array<ArrayBuffer>; readonly etag: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly code: "artifact_unavailable" | "thumbnail_unavailable" };

/** Cache identity: project + artifact revision + artifact digest + renderer version. */
export function projectThumbnailIdentity(project: ThumbnailIdentitySource): string | null {
  if (project.current_digest === null) return null;
  return createHash("sha256")
    .update(`burnguard-thumbnail\n${RENDERER_VERSION}\n${project.id}\n${project.current_revision}\n${project.current_digest}`)
    .digest("hex");
}

/** The read URL for a project thumbnail, or null while the project has no artifact digest. */
export function projectThumbnailUrl(project: ThumbnailIdentitySource): string | null {
  const identity = projectThumbnailIdentity(project);
  if (identity === null) return null;
  return `/api/projects/${encodeURIComponent(project.id)}/thumbnail?v=${identity}`;
}

/**
 * Answers within the response deadline no matter what the render is doing.
 * The work behind an expired wait is never cancelled: it keeps its slot,
 * finishes into the cache and serves the next request.
 */
export async function loadProjectThumbnail(
  projectId: string,
  render: ThumbnailRenderer = renderThumbnailWithChromium,
  temporaryId: () => string = randomUUID,
): Promise<ThumbnailOutcome> {
  const work = loadProjectThumbnailUncapped(projectId, render, temporaryId);
  const deadlineMs = renderResponseDeadlineMs();
  if (deadlineMs <= 0) {
    void work.catch(() => undefined);
    return { kind: "unavailable", code: "thumbnail_unavailable" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<ThumbnailOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "unavailable", code: "thumbnail_unavailable" }), deadlineMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void work.catch(() => undefined);
  }
}

async function loadProjectThumbnailUncapped(
  projectId: string,
  render: ThumbnailRenderer,
  temporaryId: () => string,
): Promise<ThumbnailOutcome> {
  const project = await getProjectDetail(projectId);
  if (project === null) return { kind: "not_found" };

  const identity = projectThumbnailIdentity(project);
  if (identity === null) return { kind: "unavailable", code: "artifact_unavailable" };

  // The DB thumbnail_path is never trusted as a filesystem path: the cache
  // location is derived from the managed projects root and the identity hash.
  let projectDir: string;
  let cachePath: string;
  try {
    projectDir = resolveManagedPath(projectsDir, project.dir_path);
    cachePath = resolveWithin(projectDir, ...CACHE_SEGMENTS, `${identity}.png`);
  } catch (error) {
    if (error instanceof PathBoundaryError) return { kind: "unavailable", code: "thumbnail_unavailable" };
    throw error;
  }

  const cached = await readThumbnailFile(cachePath);
  if (cached !== null) return { kind: "ready", bytes: cached, etag: `"${identity}"` };

  if (process.env.BG_THUMBNAIL_CACHE_ONLY === "1") {
    return { kind: "unavailable", code: "thumbnail_unavailable" };
  }

  if (Date.now() < chromiumUnavailableUntil) return { kind: "unavailable", code: "thumbnail_unavailable" };

  // Never start an in-process launch before the child-process probe says a
  // launch actually completes here: on a host where it does not, the launch
  // blocks the event loop and takes the whole backend down with it.
  if (!(await isChromiumLaunchable(undefined, { waitForResult: true }))) return { kind: "unavailable", code: "thumbnail_unavailable" };

  const rendered = await renderThumbnailOnce(cachePath, {
    request: {
      stagedDir: projectDir,
      entrypoint: project.entrypoint,
      outputPath: cachePath,
      deck: project.type === "slide_deck",
      signal: new AbortController().signal,
    },
    render,
    temporaryId,
  });
  if (rendered === null) return { kind: "unavailable", code: "thumbnail_unavailable" };
  return { kind: "ready", bytes: rendered, etag: `"${identity}"` };
}

function renderResponseDeadlineMs(): number {
  const override = Number(process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS);
  return Number.isFinite(override) && override >= 0 ? override : RENDER_RESPONSE_DEADLINE_MS;
}

/** Coalesces concurrent misses on one cache entry so a card that is already rendering is never rendered twice. */
function renderThumbnailOnce(cacheKey: string, input: {
  readonly request: ThumbnailRenderRequest;
  readonly render: ThumbnailRenderer;
  readonly temporaryId: () => string;
}): Promise<Uint8Array<ArrayBuffer> | null> {
  const existing = inFlightRenders.get(cacheKey);
  if (existing !== undefined) return existing;
  const pending = withRenderSlot(() => renderThumbnailFile(input)).finally(() => { inFlightRenders.delete(cacheKey); });
  inFlightRenders.set(cacheKey, pending);
  return pending;
}

/** Hands a freed slot straight to the next waiter so the cap can never be oversubscribed. */
async function withRenderSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) await new Promise<void>((resolve) => { waitingRenders.push(resolve); });
  else activeRenders += 1;
  try {
    return await run();
  } finally {
    const next = waitingRenders.shift();
    if (next === undefined) activeRenders -= 1;
    else next();
  }
}

/** Renders into a sibling temporary file and publishes it with an atomic rename. */
async function renderThumbnailFile(input: {
  readonly request: ThumbnailRenderRequest;
  readonly render: ThumbnailRenderer;
  readonly temporaryId: () => string;
}): Promise<Uint8Array<ArrayBuffer> | null> {
  const cachePath = input.request.outputPath;
  const temporaryPath = `${cachePath}.${process.pid}.${input.temporaryId()}.tmp`;
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await input.render({ ...input.request, outputPath: temporaryPath });
    const bytes = await readThumbnailFile(temporaryPath);
    if (bytes === null) return null;
    await rename(temporaryPath, cachePath);
    return bytes;
  } catch (error) {
    if (error instanceof Error) {
      if (isChromiumUnavailable(error)) chromiumUnavailableUntil = Date.now() + chromiumCooldownMs();
      return null;
    }
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/** Only a launch failure means "no Chromium here" — a per-project render failure must not silence the whole grid. */
function isChromiumUnavailable(error: Error): boolean {
  return "code" in error && (error.code === "chromium_launch_timeout" || error.code === "chromium_not_installed");
}

function chromiumCooldownMs(): number {
  const override = Number(process.env.BG_THUMBNAIL_CHROMIUM_COOLDOWN_MS);
  return Number.isFinite(override) && override > 0 ? override : CHROMIUM_UNAVAILABLE_COOLDOWN_MS;
}

/** Returns the PNG bytes only when the file exists and carries the exact expected image. */
async function readThumbnailFile(filePath: string): Promise<Uint8Array<ArrayBuffer> | null> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(await readFile(filePath));
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  try {
    const header = parsePng(bytes);
    return header.width === THUMBNAIL_WIDTH && header.height === THUMBNAIL_HEIGHT ? bytes : null;
  } catch (error) {
    if (error instanceof PngValidationError) return null;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

// Imported lazily so the project list, which only builds thumbnail URLs, never
// pulls playwright-core into the process.
async function renderThumbnailWithChromium(request: ThumbnailRenderRequest): Promise<void> {
  const { renderToPng } = await import("./export-png");
  await renderToPng({
    stagedDir: request.stagedDir,
    entrypoint: request.entrypoint,
    outputPath: request.outputPath,
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    dpr: 1,
    deck: request.deck,
    signal: request.signal,
  });
}
