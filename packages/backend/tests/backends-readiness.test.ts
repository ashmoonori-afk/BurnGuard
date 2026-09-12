import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectBackends, probeCodexAuthentication } from "../src/services/backends";
import { homeRoutes } from "../src/routes/home";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { startUserTurn } from "../src/services/turns";

let root: string;
let binary: string;
let which: ReturnType<typeof spyOn<typeof Bun, "which">>;
const originalCodexHome = process.env.CODEX_HOME;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bg-readiness-"));
  binary = path.join(root, "codex");
  await writeFile(binary, `#!${process.execPath}
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
const root = ${JSON.stringify(root)};
if (process.argv[2] === "--version") { console.log("fixture-cli"); process.exit(0); }
if (process.argv.slice(2).join(" ") !== "login status") process.exit(99);
appendFileSync(root + "/calls", "probe\\n");
const mode = readFileSync(root + "/mode", "utf8");
if (mode === "login") { console.error("Logged in using ChatGPT"); process.exit(0); }
if (mode === "logout") { console.error("Not logged in"); process.exit(1); }
if (mode === "timeout") {
  writeFileSync(root + "/pid", String(process.pid));
  process.on("SIGTERM", () => {});
  // Time is the behavior under test: hold this process until the probe deadline kills it.
  setInterval(() => {}, 60_000);
} else {
  console.error("PRIVATE_PROBE_SENTINEL");
  process.exit(mode === "unexpected" ? 0 : 2);
}
`);
  await chmod(binary, 0o755);
  await writeFile(path.join(root, "calls"), "");
  process.env.CODEX_HOME = root;
  which = spyOn(Bun, "which").mockImplementation((name) => name === "codex" ? binary : null);
});

afterAll(async () => {
  try {
    // Invalidate the singleton cache before restoring the real process boundary.
    await mode("error");
    await expect(detectBackends({ force: true })).rejects.toMatchObject({ code: "codex_authentication_probe_failed" });
  } finally {
    which.mockRestore();
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});

async function mode(value: string) { await writeFile(path.join(root, "mode"), value); }
async function calls() { return (await readFile(path.join(root, "calls"), "utf8")).trim().split("\n").filter(Boolean).length; }
function codex(result: Awaited<ReturnType<typeof detectBackends>>) {
  const backend = result.backends.find((backend) => backend.id === "codex");
  if (!backend) throw new Error("Missing Codex detection");
  return backend;
}

test("a failed force probe is indeterminate, never cached logout or stale authorization", async () => {
  await mode("login");
  expect(codex(await detectBackends({ force: true })).authenticated).toBe(true);
  await mode("error");
  const before = await calls();
  await expect(detectBackends({ force: true })).rejects.toMatchObject({
    code: "codex_authentication_probe_failed",
    diagnostics: { reason: "execution_failed", exit_code: 2 },
  });
  expect(await calls()).toBe(before + 1); // No automatic retry.
  await mode("logout");
  expect(codex(await detectBackends()).authenticated).toBe(false); // Neither warm true nor transient false survived.
  expect(await calls()).toBe(before + 2);
  await mode("login");
  expect(codex(await detectBackends()).authenticated).toBe(false); // Confirmed logout still caches.
  expect(await calls()).toBe(before + 2);
  expect(codex(await detectBackends({ force: true })).authenticated).toBe(true);
});

for (const value of ["error", "unexpected"] as const) test(`${value} output is not confirmed logout and diagnostics contain no CLI output`, async () => {
  await mode(value);
  const error = await probeCodexAuthentication(binary).catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "codex_authentication_probe_failed", diagnostics: { reason: value === "error" ? "execution_failed" : "unexpected_response", exit_code: value === "error" ? 2 : 0, elapsed_ms: expect.any(Number) } });
  expect(JSON.stringify(error)).not.toContain("PRIVATE_PROBE_SENTINEL");
});

test("spawn errors are indeterminate rather than logout", async () => {
  await expect(probeCodexAuthentication(path.join(root, "missing"))).rejects.toMatchObject({ code: "codex_authentication_probe_failed", diagnostics: { reason: "execution_failed", exit_code: null } });
});

test("a timed-out probe is bounded, classified separately, and its process is reaped", async () => {
  await mode("timeout");
  await expect(probeCodexAuthentication(binary)).rejects.toMatchObject({ code: "codex_authentication_probe_failed", diagnostics: { reason: "timeout", elapsed_ms: expect.any(Number) } });
  const pid = Number(await readFile(path.join(root, "pid"), "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
}, 10_000);

test("turn start forces a fresh check and an indeterminate probe never invokes the adapter", async () => {
  const projectId = `readiness-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "index.html"), "base");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'graphic',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  try {
    await mode("login");
    expect(codex(await detectBackends({ force: true })).authenticated).toBe(true);
    await mode("error");
    let invoked = false;
    const turn = startUserTurn(sessionId, { type: "user.message", text: "Create" }, undefined, {
      detectBackends,
      runAdapter: async () => { invoked = true; return { exitCode: 0 }; },
    });
    if (!turn) throw new Error("Turn reservation unavailable");
    const outcomes = await Promise.allSettled([turn.prepared, turn.promise]);
    for (const outcome of outcomes) expect(outcome).toMatchObject({ status: "rejected", reason: { code: "codex_authentication_probe_failed" } });
    expect(invoked).toBe(false);
    expect(getSqlite().query("SELECT status FROM sessions WHERE id=?").get(sessionId)).toEqual({ status: "idle" });
    expect(await readFile(path.join(projectDir, "index.html"), "utf8")).toBe("base");
  } finally {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("readiness and graphic creation expose uncached 503 on probe failure, retain 409 for logout, and recover on the next request", async () => {
  await mode("login");
  expect(codex(await detectBackends({ force: true })).authenticated).toBe(true);
  const projectsBefore = getSqlite().query("SELECT COUNT(*) AS count FROM projects").get();
  const body = JSON.stringify({ name: "Probe safety", type: "graphic", backend_id: "codex", design_system_id: null, options: { graphic_canvas: { schema_version: 1, width: 1080, height: 1080 } } });
  await mode("error");
  const before = await calls();
  const creation = await homeRoutes.request("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  expect(creation.status).toBe(503);
  expect(creation.headers.get("Cache-Control")).toBe("no-store");
  expect((await creation.json()).error).toMatchObject({ code: "codex_authentication_probe_failed", details: { reason: "execution_failed", exit_code: 2 } });
  expect(await calls()).toBe(before + 1);
  const readiness = await homeRoutes.request("/api/backends/detect");
  expect(readiness.status).toBe(503);
  expect(readiness.headers.get("Cache-Control")).toBe("no-store");
  expect(await calls()).toBe(before + 2);
  expect(getSqlite().query("SELECT COUNT(*) AS count FROM projects").get()).toEqual(projectsBefore);
  await mode("login");
  const recovered = await homeRoutes.request("/api/backends/detect");
  expect(recovered.status).toBe(200);
  expect(codex((await recovered.json()).data).authenticated).toBe(true);
  expect(await calls()).toBe(before + 3);
  await mode("logout");
  const loggedOut = await homeRoutes.request("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  expect(loggedOut.status).toBe(409);
  expect((await loggedOut.json()).error.code).toBe("graphic_requires_authenticated_codex");
  expect(getSqlite().query("SELECT COUNT(*) AS count FROM projects").get()).toEqual(projectsBefore);
});
