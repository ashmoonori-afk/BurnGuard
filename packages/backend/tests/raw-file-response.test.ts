import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { systemsDir } from "../src/lib/paths";
import { rawFileHeaders } from "../src/security/raw-file-response";
import { createApp } from "../src/server";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import * as artifactStorage from "../src/services/artifact-tree-storage";

const tempDirs: string[] = [];
const projectIds: string[] = [];
const systemIds: string[] = [];

function directives(policy: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of (policy ?? "").split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

function insertProject(dirPath: string): string {
  const projectId = `project-${randomUUID()}`;
  const now = Date.now();
  getSqlite().prepare(`INSERT INTO projects (id, name, type, design_system_id, dir_path, entrypoint, backend_id, created_at, updated_at) VALUES (?, ?, 'prototype', NULL, ?, 'index.html', 'claude-code', ?, ?)`).run(projectId, projectId, dirPath, now, now);
  projectIds.push(projectId);
  return projectId;
}

function insertSystem(dirPath: string, systemId: string): string {
  const now = Date.now();
  getSqlite().prepare(`INSERT INTO design_systems (id, name, status, source_type, is_template, dir_path, created_at, updated_at) VALUES (?, ?, 'draft', 'manual', 0, ?, ?, ?)`).run(systemId, systemId, dirPath, now, now);
  systemIds.push(systemId);
  return systemId;
}

beforeAll(async () => {
  await runMigrations();
  await mkdir(systemsDir, { recursive: true });
});

afterAll(async () => {
  const db = getSqlite();
  for (const projectId of projectIds.splice(0)) {
    db.prepare("DELETE FROM files WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  }
  for (const systemId of systemIds.splice(0)) db.prepare("DELETE FROM design_systems WHERE id = ?").run(systemId);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("raw file response headers", () => {
  test("Given concurrent asset reads When loading Then one canonical observation is shared and later edits are revalidated", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "raw-batch-"));
    tempDirs.push(root);
    const names = Array.from({ length: 12 }, (_, index) => `asset-${index}.svg`);
    await Promise.all(names.map(name => writeFile(path.join(root, name), `<svg><!--${name}--></svg>`)));
    const projectId = insertProject(root);
    const app = createApp();
    await new ArtifactCoordinator(getSqlite()).initialize(projectId, root);
    const observe = spyOn(ArtifactCoordinator.prototype, "observeExternal");
    try {
      const responses = await Promise.all(names.map(name => app.request(`/api/projects/${projectId}/fs/${name}`)));
      expect(responses.map(response => response.status)).toEqual(names.map(() => 200));
      expect(observe).toHaveBeenCalledTimes(1);
      const oldHash = responses[0]!.headers.get("x-burnguard-file-hash");
      const oldDigest = responses[0]!.headers.get("x-burnguard-artifact-digest");
      await writeFile(path.join(root, names[0]!), "<svg>updated</svg>");
      const next = await app.request(`/api/projects/${projectId}/fs/${names[0]}`);
      expect(next.status).toBe(200);
      expect(await next.text()).toBe("<svg>updated</svg>");
      expect(observe).toHaveBeenCalledTimes(2);
      expect(next.headers.get("x-burnguard-file-hash")).not.toBe(oldHash);
      expect(next.headers.get("x-burnguard-artifact-digest")).not.toBe(oldDigest);
    } finally { observe.mockRestore(); }
  });

  const request = (dest: string | null) => new Request("http://localhost/api/projects/p/fs/index.html", dest === null ? {} : { headers: { "sec-fetch-dest": dest } });

  test("Given a top-level document navigation When raw HTML is served Then it is delivered as an attachment with nosniff", () => {
    const headers = rawFileHeaders(request("document"), { contentType: "text/html; charset=utf-8", filename: "index.html" });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Disposition"]).toMatch(/^attachment;/);
  });

  test("Given an iframe or fetch request When raw HTML is served Then it renders inline under an artifact CSP bound to the request origin", () => {
    for (const dest of ["iframe", "empty", null]) {
      const headers = rawFileHeaders(request(dest), { contentType: "text/html; charset=utf-8", filename: "index.html" });
      expect(headers["Content-Disposition"]).toBeUndefined();
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      const policy = directives(headers["Content-Security-Policy"] ?? null);
      expect(policy.get("connect-src")).toEqual(["http://localhost"]);
      expect(policy.get("form-action")).toEqual(["'none'"]);
      expect(policy.get("frame-ancestors")).toEqual(["http://localhost"]);
      expect(policy.get("frame-src")).toEqual(["https://www.google.com/maps/embed", "https://www.google.com/maps/embed/"]);
      expect(policy.get("object-src")).toEqual(["'none'"]);
    }
  });

  test("Given an inert image When served inline Then no artifact CSP is attached but nosniff still is", () => {
    const headers = rawFileHeaders(request("image"), { contentType: "image/png", filename: "a.png" });
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(rawFileHeaders(request("iframe"), { contentType: "image/svg+xml", filename: "a.svg" })["Content-Security-Policy"]).toBeDefined();
  });
});

describe("raw file routes", () => {
  test.each(["beforeSourceOpen", "beforeSourceRead"] as const)("Given a same-byte external directory swap %s When reading a managed file Then the route refuses the changed identity", async (phase) => {
    const root = await mkdtemp(path.join(tmpdir(), "raw-swap-"));
    const outside = await mkdtemp(path.join(tmpdir(), "raw-outside-"));
    tempDirs.push(root, outside);
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "image.svg"), "<svg>same bytes</svg>");
    await writeFile(path.join(outside, "image.svg"), "<svg>same bytes</svg>");
    const projectId = insertProject(root);
    await new ArtifactCoordinator(getSqlite()).initialize(projectId, root);
    const originalRead = artifactStorage.readManagedFile;
    const reader = spyOn(artifactStorage, "readManagedFile").mockImplementation((source, file) => originalRead(source, file, {
      [phase]: async () => {
        await rename(path.join(root, "assets"), path.join(root, "saved-assets"));
        await symlink(outside, path.join(root, "assets"), process.platform === "win32" ? "junction" : "dir");
      },
    }));
    try {
      const response = await createApp().request(`/api/projects/${projectId}/fs/assets/image.svg`);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "artifact_identity_unavailable", message: "Artifact changed while loading" } });
    } finally { reader.mockRestore(); }
  });

  test("Given project HTML When navigated top-level Then the fs route attaches; when framed it renders with the artifact CSP", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "raw-fs-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "index.html"), "<h1>valid</h1><script>fetch('/api/bootstrap')</script>", "utf8");
    const projectId = insertProject(root);
    const app = createApp();

    const navigated = await app.request(`/api/projects/${projectId}/fs/index.html`, { headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" } });
    const framed = await app.request(`/api/projects/${projectId}/fs/index.html`, { headers: { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" } });
    const fetched = await app.request(`/api/projects/${projectId}/fs/index.html`);

    expect([navigated.status, framed.status, fetched.status]).toEqual([200, 200, 200]);
    expect(navigated.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(navigated.headers.get("x-content-type-options")).toBe("nosniff");
    expect(framed.headers.get("content-disposition")).toBeNull();
    expect(directives(framed.headers.get("content-security-policy")).get("connect-src")).toEqual(["http://localhost"]);
    expect(directives(framed.headers.get("content-security-policy")).get("frame-ancestors")).toEqual(["http://localhost"]);
    expect(fetched.headers.get("content-disposition")).toBeNull();
    // The route may decorate elements with editable ids; the authored text must still flow through.
    expect(await fetched.text()).toContain("valid</h1>");
  });

  test("Given a saved draw When navigated top-level Then the draws route attaches its SVG", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "raw-draw-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "index.html"), "<h1>draw</h1>", "utf8");
    await mkdir(path.join(root, ".meta", "draws"), { recursive: true });
    await writeFile(path.join(root, ".meta", "draws", "note.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", "utf8");
    const projectId = insertProject(root);
    const app = createApp();

    const navigated = await app.request(`/api/projects/${projectId}/draws/note`, { headers: { "sec-fetch-dest": "document" } });
    const framed = await app.request(`/api/projects/${projectId}/draws/note`, { headers: { "sec-fetch-dest": "image" } });

    expect([navigated.status, framed.status]).toEqual([200, 200]);
    expect(navigated.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(navigated.headers.get("x-content-type-options")).toBe("nosniff");
    expect(framed.headers.get("content-disposition")).toBeNull();
  });

  test("Given a design-system preview When navigated top-level Then the catalog file route attaches; when framed it renders with the artifact CSP", async () => {
    // Catalog files resolve only from the canonical <systemsDir>/<id> location.
    const systemId = `system-${randomUUID()}`;
    const root = path.join(systemsDir, systemId);
    tempDirs.push(root);
    await mkdir(path.join(root, "preview"), { recursive: true });
    await writeFile(path.join(root, "preview", "index.html"), "<h1>preview</h1>", "utf8");
    await writeFile(path.join(root, "colors_and_type.css"), ":root{--x:#000}", "utf8");
    insertSystem(root, systemId);
    const app = createApp();

    const navigated = await app.request(`/api/design-systems/${systemId}/files/preview/index.html`, { headers: { "sec-fetch-dest": "document" } });
    const framed = await app.request(`/api/design-systems/${systemId}/files/preview/index.html`, { headers: { "sec-fetch-dest": "iframe" } });
    const stylesheet = await app.request(`/api/design-systems/${systemId}/files/colors_and_type.css`, { headers: { "sec-fetch-dest": "style" } });

    expect([navigated.status, framed.status, stylesheet.status]).toEqual([200, 200, 200]);
    expect(navigated.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(framed.headers.get("content-disposition")).toBeNull();
    expect(directives(framed.headers.get("content-security-policy")).get("form-action")).toEqual(["'none'"]);
    expect(directives(framed.headers.get("content-security-policy")).get("frame-ancestors")).toEqual(["http://localhost"]);
    expect(stylesheet.headers.get("x-content-type-options")).toBe("nosniff");
    expect(stylesheet.headers.get("content-disposition")).toBeNull();
  });
});
