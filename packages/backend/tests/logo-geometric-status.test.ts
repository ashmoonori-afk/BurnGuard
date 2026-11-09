import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOGO_GEOMETRIC_ANSWERS_FILE, LOGO_GEOMETRY_FILE, parseLogoGeometricStatusV1, serializeLogoGeometricAnswers, type LogoSetV1 } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { BURNGUARD_CAPABILITY_HEADER } from "../src/security/request-authority";
import { createApp, classifyApiRoute } from "../src/server";
import { LOGO_GEOMETRIC_APPROVALS_FILE, LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE } from "../src/services/logo-geometric-step";
import { LOGO_GEOMETRIC_ENV, readLogoGeometricStatus } from "../src/services/logo-geometric-turn";

const sha = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");
const abstractSet: LogoSetV1 = { schema_version: 1, brand_name: "Northstar", niche: "Cycling studio", character: ["precise"], logo_type: "abstract" };
const RECORD = `${JSON.stringify({ schema_version: 1, grid: 64, primitives: [] })}\n`;
const ANSWERS = serializeLogoGeometricAnswers({ schema_version: 1, parts: { choice: "symbol" }, direction: { choice: "auto" } });
const review = (recordSha256: string, kinds: readonly string[], passed = kinds.length === 0): string =>
  JSON.stringify({ record_sha256: recordSha256, passed, findings: kinds.map((kind) => ({ kind, primitives: ["a"] })) });
const approvals = (symbol: string): string => JSON.stringify({ schema_version: 1, approvals: { symbol } });

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relative, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
    await writeFile(path.join(dir, relative), bytes);
  }
}

describe("readLogoGeometricStatus", () => {
  const dirs: string[] = [];
  const project = async (files: Record<string, string> = {}): Promise<string> => {
    const dir = await mkdtemp(path.join(tmpdir(), `bg-logo-geometric-status-${process.pid}-`));
    dirs.push(dir);
    await writeFiles(dir, files);
    return dir;
  };
  afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

  test("Given the switch off, a drawn mark type or no logo set When read Then the status is raster even with geometric files on disk", async () => {
    const dir = await project({ [LOGO_GEOMETRIC_ANSWERS_FILE]: ANSWERS, [LOGO_GEOMETRY_FILE]: RECORD });
    expect(await readLogoGeometricStatus(dir, abstractSet, false)).toEqual({ schema_version: 1, method: "raster" });
    expect(await readLogoGeometricStatus(dir, { ...abstractSet, logo_type: "mascot" }, true)).toEqual({ schema_version: 1, method: "raster" });
    expect(await readLogoGeometricStatus(dir, null, true)).toEqual({ schema_version: 1, method: "raster" });
  });

  test("Given a geometric project with nothing answered When read Then answers are null, nothing is recorded and only the symbol can be made", async () => {
    const status = parseLogoGeometricStatusV1(await readLogoGeometricStatus(await project(), abstractSet, true));
    if (status.method !== "geometric") throw new Error("expected geometric");
    expect(status.answers).toBeNull();
    expect(status.available_steps).toEqual(["symbol"]);
    expect(status.records).toEqual({ symbol: null, wordmark: null, lockup: null });
    expect(status.symbol_review).toBeNull();
  });

  test("Given answers, a symbol record and its review When read Then the symbol awaits review and the findings are reduced to unique kinds", async () => {
    const recordSha = sha(RECORD);
    const dir = await project({
      [LOGO_GEOMETRIC_ANSWERS_FILE]: ANSWERS,
      [LOGO_GEOMETRY_FILE]: RECORD,
      [LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE]: review(recordSha, ["near_touch", "sliver", "near_touch"]),
    });
    const status = parseLogoGeometricStatusV1(await readLogoGeometricStatus(dir, abstractSet, true));
    if (status.method !== "geometric") throw new Error("expected geometric");
    expect(status.answers?.parts).toEqual({ choice: "symbol" });
    expect(status.plan).toEqual([{ step: "symbol", status: "awaiting_review" }]);
    expect(status.records.symbol).toBe(recordSha);
    expect(status.symbol_review).toEqual({ passed: false, findings: ["near_touch", "sliver"] });
  });

  test("Given a review written for other bytes or naming an unknown kind When read Then the review is not shown", async () => {
    const stale = await project({ [LOGO_GEOMETRIC_ANSWERS_FILE]: ANSWERS, [LOGO_GEOMETRY_FILE]: RECORD, [LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE]: review(sha("older bytes"), []) });
    const unknown = await project({ [LOGO_GEOMETRIC_ANSWERS_FILE]: ANSWERS, [LOGO_GEOMETRY_FILE]: RECORD, [LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE]: review(sha(RECORD), ["wobble"]) });
    const broken = await project({ [LOGO_GEOMETRIC_ANSWERS_FILE]: ANSWERS, [LOGO_GEOMETRY_FILE]: RECORD, [LOGO_GEOMETRIC_SYMBOL_REVIEW_FILE]: "{" });
    for (const dir of [stale, unknown, broken]) {
      const status = await readLogoGeometricStatus(dir, abstractSet, true);
      expect(status.method === "geometric" && status.symbol_review).toBeNull();
    }
  });

  test("Given the symbol approved for the bytes on disk When read Then the plan reports it done", async () => {
    const dir = await project({ [LOGO_GEOMETRIC_ANSWERS_FILE]: ANSWERS, [LOGO_GEOMETRY_FILE]: RECORD, [LOGO_GEOMETRIC_APPROVALS_FILE]: approvals(sha(RECORD)) });
    const status = await readLogoGeometricStatus(dir, abstractSet, true);
    expect(status.method === "geometric" && status.plan).toEqual([{ step: "symbol", status: "done" }]);
  });
});

describe("GET /api/projects/:id/logo/geometric", () => {
  const capability = "logo-geometric-route-capability";
  const app = createApp({ capability, appAuthority: "127.0.0.1:14070" });
  const suffix = `${process.pid}-${Date.now()}`;
  const logoProject = `logo-geometric-${suffix}`;
  const webProject = `logo-geometric-web-${suffix}`;
  const previous = process.env[LOGO_GEOMETRIC_ENV];

  const request = (pathname: string, authorized = true): Promise<Response> => {
    const headers = new Headers({ host: "127.0.0.1:14070", origin: "http://127.0.0.1:14070" });
    if (authorized) headers.set(BURNGUARD_CAPABILITY_HEADER, capability);
    return app.request(new Request(`http://127.0.0.1:14070${pathname}`, { headers }));
  };

  beforeAll(async () => {
    runMigrations();
    const insert = getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,?,?,'index.html','codex',?,1,1)");
    insert.run(logoProject, logoProject, "logo", path.join(projectsDir, logoProject), JSON.stringify({ logo_set: abstractSet }));
    insert.run(webProject, webProject, "prototype", path.join(projectsDir, webProject), null);
    await writeFiles(path.join(projectsDir, logoProject), { [LOGO_GEOMETRIC_ANSWERS_FILE]: ANSWERS });
  });
  afterEach(() => {
    if (previous === undefined) delete process.env[LOGO_GEOMETRIC_ENV];
    else process.env[LOGO_GEOMETRIC_ENV] = previous;
  });
  afterAll(async () => {
    getSqlite().prepare("DELETE FROM projects WHERE id IN (?, ?)").run(logoProject, webProject);
    await rm(path.join(projectsDir, logoProject), { recursive: true, force: true });
  });

  test("Given the route family When classified Then it has its own domain", () => {
    expect(classifyApiRoute(`/api/projects/${logoProject}/logo/geometric`)).toBe("logo-geometric");
  });

  test("Given the switch on or off When the status is read Then the body follows the switch and parses with the shared contract", async () => {
    delete process.env[LOGO_GEOMETRIC_ENV];
    const off = await request(`/api/projects/${logoProject}/logo/geometric`);
    expect(off.status).toBe(200);
    expect(parseLogoGeometricStatusV1(((await off.json()) as { data: unknown }).data)).toEqual({ schema_version: 1, method: "raster" });
    process.env[LOGO_GEOMETRIC_ENV] = "1";
    const on = await request(`/api/projects/${logoProject}/logo/geometric`);
    expect(on.status).toBe(200);
    const status = parseLogoGeometricStatusV1(((await on.json()) as { data: unknown }).data);
    expect(status.method === "geometric" && status.answers?.parts).toEqual({ choice: "symbol" });
  });

  test("Given a project that is not a logo, a missing project or no capability When requested Then it is refused without a body", async () => {
    process.env[LOGO_GEOMETRIC_ENV] = "1";
    const web = await request(`/api/projects/${webProject}/logo/geometric`);
    expect(web.status).toBe(404);
    expect(((await web.json()) as { error: { code: string } }).error.code).toBe("project_not_found");
    expect((await request(`/api/projects/missing-${suffix}/logo/geometric`)).status).toBe(404);
    expect((await request(`/api/projects/${logoProject}/logo/geometric`, false)).status).toBe(403);
  });
});
