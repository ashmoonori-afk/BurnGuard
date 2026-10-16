import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { createProjectFolderRoutes } from "../src/routes/project-folder";
import { createRequestAuthority } from "../src/security/request-authority";
import { classifyApiRoute, createApp } from "../src/server";
// Load the lazy domain before measuring request behavior; cold module I/O is not this test's contract.
import "../src/routes/project";

let root: string;
let directory: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "project-folder-"));
  directory = path.join(root, "Project with spaces");
  await mkdir(directory);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

function request(id = "known", headers: Record<string, string> = {}) {
  return new Request(`http://127.0.0.1:14070/api/projects/${id}/show-folder`, {
    method: "POST",
    headers: { host: "127.0.0.1:14070", origin: "http://127.0.0.1:14070", "x-burnguard-capability": "folder-test", ...headers },
  });
}

for (const [platform, command] of [["darwin", "open"], ["win32", "explorer.exe"], ["linux", "xdg-open"]] as const) {
  test(`Given a contained project When revealing on ${platform} Then one path is passed as an argv entry`, async () => {
    const calls: Array<readonly string[]> = [];
    const routes = createProjectFolderRoutes({
      projectsRoot: root, platform,
      findProject: async () => ({ dir_path: directory }),
      spawn: async (argv) => { calls.push(argv); },
    });
    const response = await routes.request(request());
    expect(response.status).toBe(204);
    expect(calls).toEqual([[command, directory]]);
    expect(await response.text()).toBe("");
  });
}

test("Given an unknown project When revealing Then no process is launched", async () => {
  const calls: unknown[] = [];
  const routes = createProjectFolderRoutes({
    projectsRoot: root, findProject: async () => null,
    spawn: async (argv) => { calls.push(argv); },
  });
  const response = await routes.request(request("missing"));
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe("project_not_found");
  expect(calls).toEqual([]);
});

test("Given paths outside or equal to the projects root When revealing Then the route refuses without leaking paths", async () => {
  for (const dir_path of [path.dirname(root), root, path.join(root, "..", "outside")]) {
    const calls: unknown[] = [];
    const routes = createProjectFolderRoutes({
      projectsRoot: root, findProject: async () => ({ dir_path }),
      spawn: async (argv) => { calls.push(argv); },
    });
    const response = await routes.request(request());
    const body = await response.text();
    expect(response.status).toBe(409);
    expect(JSON.parse(body).error.code).toBe("project_path_unavailable");
    expect(body).not.toContain(root);
    expect(body).not.toContain(dir_path);
    expect(calls).toEqual([]);
  }
});

test("Given a symlink or junction escaping the root When revealing Then containment resolves its real destination", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "folder-outside-"));
  try {
    const link = path.join(root, "escaped");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    const routes = createProjectFolderRoutes({
      projectsRoot: root, findProject: async () => ({ dir_path: link }),
      spawn: async () => { throw new Error("must not spawn"); },
    });
    const response = await routes.request(request());
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(outside);
  } finally { await rm(outside, { recursive: true, force: true }); }
});

test("Given a missing project directory When revealing Then the route refuses before spawning", async () => {
  const routes = createProjectFolderRoutes({
    projectsRoot: root, findProject: async () => ({ dir_path: path.join(root, "missing") }),
    spawn: async () => { throw new Error("must not spawn"); },
  });
  const response = await routes.request(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("project_path_unavailable");
});

test("Given an unsupported platform When revealing Then no unrelated command is used", async () => {
  const calls: unknown[] = [];
  const routes = createProjectFolderRoutes({
    projectsRoot: root, platform: "freebsd", findProject: async () => ({ dir_path: directory }),
    spawn: async (argv) => { calls.push(argv); },
  });
  const response = await routes.request(request());
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("project_folder_unavailable");
  expect(calls).toEqual([]);
});

for (const diagnostic of ["/Users/private/Project failed", "C:\\Users\\private\\Project failed", "\\\\server\\private\\Project failed"]) {
  test("Given a file-manager failure When responding Then private diagnostics are discarded", async () => {
    const routes = createProjectFolderRoutes({
      projectsRoot: root, findProject: async () => ({ dir_path: directory }),
      spawn: async () => { throw new Error(diagnostic); },
    });
    const response = await routes.request(request());
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(body).error.code).toBe("project_folder_unavailable");
    expect(body).not.toContain(diagnostic);
    expect(body).not.toContain(root);
  });
}

test("Given missing mutating authority When revealing Then Origin and header checks apply", async () => {
  const calls: unknown[] = [];
  const app = new Hono();
  app.use("/api/*", createRequestAuthority({ capability: "folder-test", appAuthority: "127.0.0.1:14070" }));
  app.route("/", createProjectFolderRoutes({
    projectsRoot: root, findProject: async () => ({ dir_path: directory }),
    spawn: async (argv) => { calls.push(argv); },
  }));
  const deniedHeaders: Record<string, string>[] = [{ origin: "http://evil.invalid" }, { "x-burnguard-capability": "" }];
  for (const headers of deniedHeaders) {
    expect((await app.request(request("known", headers))).status).toBe(403);
  }
  expect(calls).toEqual([]);
  expect(classifyApiRoute("/api/projects/known/show-folder", "POST")).toBe("project");
});

test("Given the production server When an unknown project folder is requested Then the reveal route is dispatched", async () => {
  const app = createApp({ capability: "folder-test", appAuthority: "127.0.0.1:14070" });
  const response = await app.request(request("missing-project"));
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe("project_not_found");
});
