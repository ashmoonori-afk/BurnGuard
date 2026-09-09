import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { runMigrations } from "../src/db/migrate-local";
import { listHomeProjects } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { homeRoutes } from "../src/routes/home";
import { classifyApiRoute } from "../src/server";
import {
  resetChromiumCapability,
  isChromiumLaunchable,
  setChromiumCapabilityForTesting,
} from "../src/services/chromium-capability";
import { parsePng } from "../src/services/export-png-validation";
import {
  loadProjectThumbnail,
  projectThumbnailIdentity,
  projectThumbnailUrl,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  type ThumbnailRenderer,
} from "../src/services/project-thumbnails";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const digestC = "c".repeat(64);
const PROJECT_TIMESTAMP = Number.MAX_SAFE_INTEGER;
const projectIds: string[] = [];
const tempDirs: string[] = [];
let sequence = 0;

function pngFixture(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#123456";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#f0f0f0";
  context.fillRect(8, 8, Math.max(1, width - 16), Math.max(1, height - 16));
  return Uint8Array.from(canvas.toBuffer("image/png"));
}

function recordingRenderer(width = THUMBNAIL_WIDTH, height = THUMBNAIL_HEIGHT) {
  const requests: Array<{ readonly stagedDir: string; readonly entrypoint: string; readonly deck: boolean }> = [];
  const renderer: ThumbnailRenderer = async (request) => {
    requests.push({ stagedDir: request.stagedDir, entrypoint: request.entrypoint, deck: request.deck });
    await writeFile(request.outputPath, pngFixture(width, height));
  };
  return { renderer, requests };
}

const failingRenderer: ThumbnailRenderer = async () => {
  throw new Error("chromium_not_installed");
};

async function createProject(options: {
  readonly digest: string | null;
  readonly revision?: number;
  readonly type?: "prototype" | "slide_deck";
  readonly dirPath?: string;
}): Promise<{ readonly id: string; readonly dirPath: string }> {
  sequence += 1;
  const id = `bg-thumb-${process.pid}-${sequence}`;
  const dirPath = options.dirPath ?? path.join(projectsDir, id);
  await mkdir(path.join(dirPath, ".meta"), { recursive: true });
  await writeFile(path.join(dirPath, "index.html"), "<!doctype html><title>t</title>", "utf8");
  getSqlite()
    .prepare(
      `INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at,current_revision,current_digest)
       VALUES (?,?,?,?,'index.html','codex',?,?,?,?)`,
    )
    .run(
      id,
      id,
      options.type ?? "prototype",
      dirPath,
      PROJECT_TIMESTAMP,
      PROJECT_TIMESTAMP,
      options.revision ?? 3,
      options.digest,
    );
  projectIds.push(id);
  if (options.dirPath === undefined) tempDirs.push(dirPath);
  return { id, dirPath };
}

/** Lets every queued load reach the renderer before a gated render is released. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, 50); });
}

function cacheDir(dirPath: string): string {
  return path.join(dirPath, ".meta", "thumbnails");
}

async function cachedFiles(dirPath: string): Promise<readonly string[]> {
  return (await readdir(cacheDir(dirPath)).catch(() => [] as string[])).filter((name) => name.endsWith(".png")).sort();
}

function request(route: string, headers?: Record<string, string>): Promise<Response> {
  return homeRoutes.request(`http://local${route}`, headers === undefined ? undefined : { headers });
}

beforeAll(async () => {
  await runMigrations();
  await mkdir(projectsDir, { recursive: true });
  // These cases inject their own renderer and never touch a real browser, so
  // the launch-capability gate is answered directly instead of spawning the
  // probe child on every run.
  setChromiumCapabilityForTesting(true);
});

afterAll(async () => {
  resetChromiumCapability();
  const db = getSqlite();
  for (const id of projectIds.splice(0)) db.prepare("DELETE FROM projects WHERE id=?").run(id);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("project thumbnail identity", () => {
  test("Given the same project revision digest and renderer When identity is derived Then it is stable and filename safe", () => {
    const project = { id: "p1", current_revision: 3, current_digest: digestA };

    const identity = projectThumbnailIdentity(project);

    expect(identity).toBe(projectThumbnailIdentity({ ...project }));
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
  });

  test("Given a changed project id revision or digest When identity is derived Then every variant differs", () => {
    const base = { id: "p1", current_revision: 3, current_digest: digestA };

    const identity = projectThumbnailIdentity(base);

    expect(projectThumbnailIdentity({ ...base, id: "p2" })).not.toBe(identity);
    expect(projectThumbnailIdentity({ ...base, current_revision: 4 })).not.toBe(identity);
    expect(projectThumbnailIdentity({ ...base, current_digest: digestB })).not.toBe(identity);
  });

  test("Given a project without a current digest When identity is derived Then there is no identity", () => {
    expect(projectThumbnailIdentity({ id: "p1", current_revision: 3, current_digest: null })).toBeNull();
  });

  test("Given a project with a digest When the thumbnail URL is built Then it carries the identity as the cache buster", () => {
    const project = { id: "p 1/x", current_revision: 3, current_digest: digestA };

    const url = projectThumbnailUrl(project);

    expect(url).toBe(`/api/projects/${encodeURIComponent("p 1/x")}/thumbnail?v=${projectThumbnailIdentity(project) ?? ""}`);
  });

  test("Given a project without a digest When the thumbnail URL is built Then no URL is exposed", () => {
    expect(projectThumbnailUrl({ id: "p1", current_revision: 0, current_digest: null })).toBeNull();
  });
});

describe("project list thumbnail exposure", () => {
  test("Given a project with a current digest When the home list is read Then thumbnail_path is the route URL and nothing is rendered", async () => {
    const project = await createProject({ digest: digestA, revision: 5 });

    const listed = (await listHomeProjects("recent", 500, 0)).items.find((item) => item.id === project.id);

    expect(listed?.thumbnail_path).toBe(
      `/api/projects/${project.id}/thumbnail?v=${projectThumbnailIdentity({ id: project.id, current_revision: 5, current_digest: digestA }) ?? ""}`,
    );
    expect(await cachedFiles(project.dirPath)).toEqual([]);
  });

  test("Given a project without a current digest When the home list is read Then thumbnail_path stays null", async () => {
    const project = await createProject({ digest: null });

    const listed = (await listHomeProjects("recent", 500, 0)).items.find((item) => item.id === project.id);

    expect(listed?.thumbnail_path).toBeNull();
  });
});

describe("project thumbnail generation and cache", () => {
  test("Given a cold browser probe beyond the capability polling deadline When the response expires Then rendering still fills the cache", async () => {
    const previousDeadline = process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS;
    const previousWait = process.env.BG_CHROMIUM_PROBE_WAIT_MS;
    process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS = "40";
    process.env.BG_CHROMIUM_PROBE_WAIT_MS = "1";
    resetChromiumCapability();
    let release!: (usable: boolean) => void;
    const gate = new Promise<boolean>((resolve) => { release = resolve; });
    const probe = isChromiumLaunchable(() => gate, { waitForResult: true });
    try {
      const project = await createProject({ digest: digestA });
      const recorded = recordingRenderer();
      let rendered!: () => void;
      const completed = new Promise<void>((resolve) => { rendered = resolve; });
      const renderer: ThumbnailRenderer = async (request) => { await recorded.renderer(request); rendered(); };
      expect(await loadProjectThumbnail(project.id, renderer)).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
      release(true);
      await probe;
      await completed;
      process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS = "30000";
      expect((await loadProjectThumbnail(project.id, renderer)).kind).toBe("ready");
      expect(recorded.requests).toHaveLength(1);
    } finally {
      release(true);
      setChromiumCapabilityForTesting(true);
      if (previousDeadline === undefined) delete process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS;
      else process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS = previousDeadline;
      if (previousWait === undefined) delete process.env.BG_CHROMIUM_PROBE_WAIT_MS;
      else process.env.BG_CHROMIUM_PROBE_WAIT_MS = previousWait;
    }
  });
  test("Given a project with no cached thumbnail When loaded Then it renders once at exactly 640x360 and stores the PNG", async () => {
    const project = await createProject({ digest: digestA });
    const { renderer, requests } = recordingRenderer();

    const outcome = await loadProjectThumbnail(project.id, renderer);

    expect(outcome.kind).toBe("ready");
    expect(requests.length).toBe(1);
    expect([THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT]).toEqual([640, 360]);
    if (outcome.kind !== "ready") throw new Error("expected a ready thumbnail");
    expect(parsePng(outcome.bytes)).toEqual({ width: 640, height: 360 });
    expect(await cachedFiles(project.dirPath)).toEqual([`${projectThumbnailIdentity({ id: project.id, current_revision: 3, current_digest: digestA }) ?? ""}.png`]);
  });

  test("Given cache-only desktop mode When a thumbnail is uncached Then it returns the fallback without probing or rendering", async () => {
    const previous = process.env.BG_THUMBNAIL_CACHE_ONLY;
    process.env.BG_THUMBNAIL_CACHE_ONLY = "1";
    try {
      const project = await createProject({ digest: digestA });
      const { renderer, requests } = recordingRenderer();

      await expect(loadProjectThumbnail(project.id, renderer)).resolves.toEqual({
        kind: "unavailable",
        code: "thumbnail_unavailable",
      });
      expect(requests).toEqual([]);
      expect(await cachedFiles(project.dirPath)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.BG_THUMBNAIL_CACHE_ONLY;
      else process.env.BG_THUMBNAIL_CACHE_ONLY = previous;
    }
  });

  test("Given concurrent cold-cache requests for one project When both miss Then a single render serves both", async () => {
    const project = await createProject({ digest: digestA });
    const outputPaths: string[] = [];
    let releaseRender: (() => void) | null = null;
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    let started: () => void = () => {};
    const renderStarted = new Promise<void>((resolve) => { started = resolve; });
    const renderer: ThumbnailRenderer = async (request) => {
      outputPaths.push(request.outputPath);
      started();
      await renderGate;
      await writeFile(
        request.outputPath,
        pngFixture(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT),
      );
    };

    const both = Promise.all([
      loadProjectThumbnail(project.id, renderer, () => "first"),
      loadProjectThumbnail(project.id, renderer, () => "second"),
    ]);
    await renderStarted;
    releaseRender?.();
    const outcomes = await both;

    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "ready",
      "ready",
    ]);
    expect(outputPaths.length).toBe(1);
    expect((await cachedFiles(project.dirPath)).length).toBe(1);
  });

  test("Given a render slower than the response deadline When requested Then the card answers immediately and the cache is filled in the background", async () => {
    const previousDeadline = process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS;
    let releaseRender: (() => void) | null = null;
    process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS = "40";
    try {
      const project = await createProject({ digest: digestA });
      const renderGate = new Promise<void>((resolve) => {
        releaseRender = resolve;
      });
      let started: () => void = () => {};
      const renderStarted = new Promise<void>((resolve) => { started = resolve; });
      let renders = 0;
      const renderer: ThumbnailRenderer = async (request) => {
        renders += 1;
        started();
        await renderGate;
        await writeFile(request.outputPath, pngFixture(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT));
      };

      // A cold miss must not hold the connection while Chromium starts: Home
      // asks for one thumbnail per card and would otherwise starve the
      // project requests queued behind them.
      const outcome = await loadProjectThumbnail(project.id, renderer);
      expect(outcome).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
      await renderStarted;
      expect(renders).toBe(1);

      releaseRender?.();
      // The abandoned render keeps going and fills the cache, so the next
      // request serves it without rendering again.
      process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS = "30000";
      const afterRender = await loadProjectThumbnail(project.id, renderer);

      expect(afterRender.kind).toBe("ready");
      expect(renders).toBe(1);
    } finally {
      releaseRender?.();
      if (previousDeadline === undefined) delete process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS;
      else process.env.BG_THUMBNAIL_RESPONSE_DEADLINE_MS = previousDeadline;
    }
  });

  test("Given concurrent cold-cache requests for different projects When both render Then their temporary files cannot collide", async () => {
    const first = await createProject({ digest: digestA });
    const second = await createProject({ digest: digestB });
    const outputPaths: string[] = [];
    const temporaryIds = ["first", "second"];
    let releaseRender: (() => void) | null = null;
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const renderer: ThumbnailRenderer = async (request) => {
      outputPaths.push(request.outputPath);
      if (outputPaths.length === 2) {
        releaseRender?.();
      }
      await renderGate;
      await writeFile(
        request.outputPath,
        pngFixture(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT),
      );
    };

    const outcomes = await Promise.all([
      loadProjectThumbnail(first.id, renderer, () => temporaryIds.shift() ?? "unexpected"),
      loadProjectThumbnail(second.id, renderer, () => temporaryIds.shift() ?? "unexpected"),
    ]);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "ready",
      "ready",
    ]);
    expect(new Set(outputPaths).size).toBe(2);
    expect(
      outputPaths
        .map((outputPath) => path.basename(outputPath).split(".").at(-2))
        .sort(),
    ).toEqual(["first", "second"]);
    expect((await cachedFiles(first.dirPath)).length).toBe(1);
    expect((await cachedFiles(second.dirPath)).length).toBe(1);
  });

  test("Given more cold cards than the render cap When they load together Then no more than two render at once", async () => {
    const projects = [
      await createProject({ digest: digestA }),
      await createProject({ digest: digestB }),
      await createProject({ digest: digestC }),
    ];
    let inFlight = 0;
    let peak = 0;
    let releaseRender: (() => void) | null = null;
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    let bothStarted: () => void = () => {};
    const renderCapacityReached = new Promise<void>((resolve) => { bothStarted = resolve; });
    const renderer: ThumbnailRenderer = async (request) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      if (inFlight === 2) bothStarted();
      await renderGate;
      await writeFile(request.outputPath, pngFixture(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT));
      inFlight -= 1;
    };

    const all = Promise.all(projects.map((project) => loadProjectThumbnail(project.id, renderer)));
    await renderCapacityReached;
    const peakWhileBlocked = peak;
    releaseRender?.();
    const outcomes = await all;

    expect(peakWhileBlocked).toBe(2);
    expect(peak).toBe(2);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["ready", "ready", "ready"]);
  });

  test("Given Chromium failing to launch When another card is requested Then the cooldown answers without relaunching", async () => {
    const previousCooldown = process.env.BG_THUMBNAIL_CHROMIUM_COOLDOWN_MS;
    process.env.BG_THUMBNAIL_CHROMIUM_COOLDOWN_MS = "120";
    try {
      const failed = await createProject({ digest: digestA });
      const other = await createProject({ digest: digestB });
      const launchTimeout: ThumbnailRenderer = async () => {
        throw Object.assign(new Error("chromium_launch_timeout: Chromium did not finish launching"), { code: "chromium_launch_timeout" });
      };
      const afterCooldown = recordingRenderer();

      expect(await loadProjectThumbnail(failed.id, launchTimeout)).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
      expect(await loadProjectThumbnail(other.id, afterCooldown.renderer)).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
      expect(afterCooldown.requests.length).toBe(0);

      await new Promise<void>((resolve) => { setTimeout(resolve, 200); });

      expect((await loadProjectThumbnail(other.id, afterCooldown.renderer)).kind).toBe("ready");
      expect(afterCooldown.requests.length).toBe(1);
    } finally {
      if (previousCooldown === undefined) delete process.env.BG_THUMBNAIL_CHROMIUM_COOLDOWN_MS;
      else process.env.BG_THUMBNAIL_CHROMIUM_COOLDOWN_MS = previousCooldown;
    }
  });

  test("Given a slide deck project When the thumbnail renders Then the deck flag and project entrypoint are used", async () => {
    const project = await createProject({ digest: digestA, type: "slide_deck" });
    const { renderer, requests } = recordingRenderer();

    await loadProjectThumbnail(project.id, renderer);

    expect(requests[0]).toEqual({ stagedDir: project.dirPath, entrypoint: "index.html", deck: true });
  });

  test("Given an already cached thumbnail When loaded again Then the cache is served without re-rendering", async () => {
    const project = await createProject({ digest: digestA });
    const { renderer, requests } = recordingRenderer();
    const first = await loadProjectThumbnail(project.id, renderer);

    const second = await loadProjectThumbnail(project.id, renderer);

    expect(requests.length).toBe(1);
    if (first.kind !== "ready" || second.kind !== "ready") throw new Error("expected ready thumbnails");
    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    expect(second.etag).toBe(first.etag);
  });

  test("Given a new artifact digest When loaded Then the stale cache entry is not served and a fresh identity is rendered", async () => {
    const project = await createProject({ digest: digestA });
    const { renderer, requests } = recordingRenderer();
    const stale = await loadProjectThumbnail(project.id, renderer);
    getSqlite().prepare("UPDATE projects SET current_digest=?, current_revision=4 WHERE id=?").run(digestB, project.id);

    const fresh = await loadProjectThumbnail(project.id, renderer);

    expect(requests.length).toBe(2);
    if (stale.kind !== "ready" || fresh.kind !== "ready") throw new Error("expected ready thumbnails");
    expect(fresh.etag).not.toBe(stale.etag);
    expect((await cachedFiles(project.dirPath)).length).toBe(2);
  });

  test("Given a corrupt cached PNG When loaded Then it regenerates exactly once and returns a valid PNG", async () => {
    const project = await createProject({ digest: digestA });
    const { renderer, requests } = recordingRenderer();
    await loadProjectThumbnail(project.id, renderer);
    const identity = projectThumbnailIdentity({ id: project.id, current_revision: 3, current_digest: digestA }) ?? "";
    await writeFile(path.join(cacheDir(project.dirPath), `${identity}.png`), "not-a-png");

    const repaired = await loadProjectThumbnail(project.id, renderer);

    expect(requests.length).toBe(2);
    if (repaired.kind !== "ready") throw new Error("expected a ready thumbnail");
    expect(parsePng(repaired.bytes)).toEqual({ width: 640, height: 360 });
    await loadProjectThumbnail(project.id, renderer);
    expect(requests.length).toBe(2);
  });

  test("Given a cached PNG with the wrong dimensions When loaded Then it is rejected and regenerated", async () => {
    const project = await createProject({ digest: digestA });
    const identity = projectThumbnailIdentity({ id: project.id, current_revision: 3, current_digest: digestA }) ?? "";
    await mkdir(cacheDir(project.dirPath), { recursive: true });
    await writeFile(path.join(cacheDir(project.dirPath), `${identity}.png`), pngFixture(320, 180));
    const correctSize = recordingRenderer();

    const outcome = await loadProjectThumbnail(project.id, correctSize.renderer);

    expect(correctSize.requests.length).toBe(1);
    if (outcome.kind !== "ready") throw new Error("expected a ready thumbnail");
    expect(parsePng(outcome.bytes)).toEqual({ width: 640, height: 360 });
  });

  test("Given a render failure When loaded Then a typed unavailable outcome is returned and the list route still answers", async () => {
    const project = await createProject({ digest: digestA });

    const outcome = await loadProjectThumbnail(project.id, failingRenderer);

    expect(outcome).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
    expect(await cachedFiles(project.dirPath)).toEqual([]);
    expect((await request("/api/projects")).status).toBe(200);
  });

  test("Given a missing project or a project without a digest When loaded Then typed not-found and unavailable outcomes are returned", async () => {
    const project = await createProject({ digest: null });

    expect(await loadProjectThumbnail(`${project.id}-missing`, failingRenderer)).toEqual({ kind: "not_found" });
    expect(await loadProjectThumbnail(project.id, failingRenderer)).toEqual({ kind: "unavailable", code: "artifact_unavailable" });
  });
});

describe("project thumbnail path boundary", () => {
  test("Given a project directory outside the managed projects root When loaded Then nothing is rendered or written", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "bg-thumb-outside-"));
    tempDirs.push(outside);
    const project = await createProject({ digest: digestA, dirPath: outside });
    const { renderer, requests } = recordingRenderer();

    const outcome = await loadProjectThumbnail(project.id, renderer);

    expect(outcome).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
    expect(requests.length).toBe(0);
    expect(await cachedFiles(outside)).toEqual([]);
  });

  test("Given a thumbnail cache directory symlinked outside the project When loaded Then the escape is refused", async () => {
    const project = await createProject({ digest: digestA });
    const escape = await mkdtemp(path.join(tmpdir(), "bg-thumb-escape-"));
    tempDirs.push(escape);
    await symlink(escape, cacheDir(project.dirPath), process.platform === "win32" ? "junction" : "dir");
    const { renderer, requests } = recordingRenderer();

    const outcome = await loadProjectThumbnail(project.id, renderer);

    expect(outcome).toEqual({ kind: "unavailable", code: "thumbnail_unavailable" });
    expect(requests.length).toBe(0);
    expect(await readdir(escape)).toEqual([]);
  });
});

describe("project thumbnail route", () => {
  test("Given a thumbnail request When the server classifies it Then the home route owns it", () => {
    expect(
      classifyApiRoute("/api/projects/project-1/thumbnail", "GET"),
    ).toBe("home");
  });

  test("Given a cached thumbnail When requested Then PNG bytes ship with a quoted ETag and private no-cache", async () => {
    const project = await createProject({ digest: digestA });
    const { renderer } = recordingRenderer();
    const cached = await loadProjectThumbnail(project.id, renderer);

    const response = await request(`/api/projects/${project.id}/thumbnail`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    if (cached.kind !== "ready") throw new Error("expected a ready thumbnail");
    expect(response.headers.get("etag")).toBe(cached.etag);
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(parsePng(new Uint8Array(await response.arrayBuffer()))).toEqual({ width: 640, height: 360 });
  });

  test("Given a matching If-None-Match When requested Then the route answers 304 with no body", async () => {
    const project = await createProject({ digest: digestA });
    const { renderer } = recordingRenderer();
    const cached = await loadProjectThumbnail(project.id, renderer);
    if (cached.kind !== "ready") throw new Error("expected a ready thumbnail");

    const response = await request(`/api/projects/${project.id}/thumbnail`, { "if-none-match": cached.etag });

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(cached.etag);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  test("Given a stale If-None-Match When requested Then the current PNG is returned", async () => {
    const project = await createProject({ digest: digestA });
    const { renderer } = recordingRenderer();
    await loadProjectThumbnail(project.id, renderer);

    const response = await request(`/api/projects/${project.id}/thumbnail`, { "if-none-match": `"${"c".repeat(64)}"` });

    expect(response.status).toBe(200);
  });

  test("Given an unknown project a digest-less project or a boundary escape When requested Then typed errors are returned", async () => {
    const withoutDigest = await createProject({ digest: null });
    const outside = await mkdtemp(path.join(tmpdir(), "bg-thumb-route-outside-"));
    tempDirs.push(outside);
    const escaped = await createProject({ digest: digestA, dirPath: outside });

    const missing = await request("/api/projects/does-not-exist/thumbnail");
    const noDigest = await request(`/api/projects/${withoutDigest.id}/thumbnail`);
    const unavailable = await request(`/api/projects/${escaped.id}/thumbnail`);

    expect([missing.status, noDigest.status, unavailable.status]).toEqual([404, 409, 503]);
    expect(await missing.json()).toEqual({ error: { code: "project_not_found", message: expect.any(String), details: { id: "does-not-exist" } } });
    expect((await noDigest.json()).error.code).toBe("artifact_unavailable");
    expect((await unavailable.json()).error.code).toBe("thumbnail_unavailable");
  });
});
