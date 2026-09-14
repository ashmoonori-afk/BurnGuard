import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { classifyApiRoute, createApp } from "../src/server";
import { catalogPaths, inspectCatalogTree } from "../src/services/catalog-files";
import { reconcileCatalogState } from "../src/services/catalog-lifecycle";
import { canCreateSymlink } from "./helpers/platform";

const app = createApp();
const ids: string[] = [];
let sequence = 0;

function id(label: string): string {
  sequence += 1;
  const value = `catalog-${process.pid}-${sequence}-${label}`;
  ids.push(value);
  return value;
}

async function seedSystem(label: string, options: { readonly receipt?: boolean; readonly name?: string; readonly exactId?: string } = {}): Promise<string> {
  const systemId = options.exactId ?? id(label);
  if (options.exactId !== undefined) ids.push(systemId);
  const dir = path.join(systemsDir, systemId);
  await mkdir(dir, { recursive: true });
  const provenanceContent = { entries: [{ identity: systemId }] };
  const digest = createHash("sha256").update(JSON.stringify(provenanceContent)).digest("hex");
  await mkdir(path.join(dir, "fonts"), { recursive: true });
  await Promise.all([
    writeFile(path.join(dir, "README.md"), `# ${systemId}\n`),
    writeFile(path.join(dir, "SKILL.md"), `---\nname: ${systemId}\n---\n`),
    writeFile(path.join(dir, "colors_and_type.css"), ":root{--brand:#123456}\n"),
    writeFile(path.join(dir, "fonts", "fonts.css"), ""),
    writeFile(path.join(dir, "extraction-provenance.json"), JSON.stringify({ schema_version: 1, digest_algorithm: "sha256", content_digest: digest, content: provenanceContent, generated_at: 100 })),
  ]);
  const now = 100;
  getSqlite().prepare(`INSERT INTO design_systems
    (id,name,status,source_type,is_template,dir_path,skill_md_path,tokens_css_path,readme_md_path,created_at,updated_at)
    VALUES (?,?, 'published','manual',0,?,?,?,?,?,?)`).run(
      systemId, options.name ?? systemId, dir, path.join(dir, "SKILL.md"),
      path.join(dir, "colors_and_type.css"), path.join(dir, "README.md"), now, now,
    );
  if (options.receipt === true) {
    const files = await Promise.all([
      "README.md", "SKILL.md", "colors_and_type.css", "extraction-provenance.json", "fonts/fonts.css",
    ].sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map(async (relativePath) => {
      const bytes = await readFile(path.join(dir, relativePath));
      return { path: relativePath, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
    }));
    const treeDigest = createHash("sha256");
    for (const file of files) treeDigest.update(file.path).update("\0").update(String(file.size)).update("\0").update(file.sha256).update("\n");
    const manifest = JSON.stringify({ schema_version: 1, digest_algorithm: "sha256", tree_digest: treeDigest.digest("hex"), files, publication_state: "validated" });
    getSqlite().prepare(`INSERT INTO design_system_receipts
      (id,design_system_id,status,content_revision,schema_version,digest,manifest_json,provenance_json,created_at,updated_at)
      VALUES (?,?, 'committed',1,1,?,?,'{"state":"observed"}',?,?)`)
      .run(`receipt-${systemId}`, systemId, digest, manifest, now, now);
  }
  return systemId;
}

async function request(method: string, url: string, body?: unknown): Promise<{ readonly status: number; readonly json: unknown }> {
  const response = await app.request(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return { status: response.status, json: null };
  const raw = await response.text();
  try {
    return { status: response.status, json: JSON.parse(raw) };
  } catch (error) {
    if (error instanceof SyntaxError) return { status: response.status, json: { error: { code: "non_json_response" }, raw } };
    throw error;
  }
}

beforeAll(async () => {
  await mkdir(systemsDir, { recursive: true });
  await runMigrations();
});

afterAll(async () => {
  const db = getSqlite();
  for (const systemId of ids.reverse()) {
    db.prepare("UPDATE projects SET design_system_id=NULL WHERE design_system_id=?").run(systemId);
    db.prepare("DELETE FROM design_systems WHERE id=?").run(systemId);
    await rm(path.join(systemsDir, systemId), { recursive: true, force: true });
    await rm(path.join(systemsDir, ".catalog-trash", systemId), { recursive: true, force: true });
  }
});

describe("production API route registration", () => {
  test("Given every API family When production routing classifies paths Then each real route remains registered", () => {
    const routes = [
      ["/api/health", "GET", "health"],
      ["/api/design-systems", "GET", "catalog"],
      ["/api/design-systems/id/files/README.md", "GET", "catalog"],
      ["/api/design-systems/extract", "POST", "system"],
      ["/api/projects", "POST", "home"],
      ["/api/projects/id", "GET", "project"],
      ["/api/projects/id/fs/index.html", "GET", "managed-files"],
      ["/api/projects/id/fs/index.html", "PATCH", "artifact-operations"],
      ["/api/projects/id/operations/op", "GET", "artifact-operations"],
      ["/api/projects/id/draws/note", "PUT", "managed-files"],
      ["/api/projects/id/exports", "POST", "artifacts"],
      ["/api/exports/id/download", "GET", "managed-files"],
      ["/api/comments/id", "PATCH", "comments"],
      ["/api/sessions/id", "GET", "session"],
      ["/api/runtime", "GET", "runtime"],
      ["/api/settings", "GET", "home"],
      ["/api/settings/playwright", "GET", "settings"],
      ["/api/settings/python", "GET", "settings"],
      ["/api/unknown", "GET", "not-found"],
    ] as const;

    expect(routes.map(([route, method]) => classifyApiRoute(route, method))).toEqual(routes.map(([, , domain]) => domain));
  });

  test("Given production request authority When bootstrap read and mutation requests arrive Then host origin cookie and capability gates dispatch correctly", async () => {
    const authorized = createApp({ capability: "catalog-test-capability", appAuthority: "catalog.test" });

    const misdirected = await authorized.request("http://wrong.test/api/health");
    const optionsDenied = await authorized.request("http://catalog.test/api/design-systems", { method: "OPTIONS", headers: { Host: "catalog.test", Origin: "http://wrong.test" } });
    const optionsAllowed = await authorized.request("http://catalog.test/api/design-systems", { method: "OPTIONS", headers: { Host: "catalog.test", Origin: "http://catalog.test" } });
    const fetchBootstrap = await authorized.request("http://catalog.test/api/bootstrap", { headers: { Host: "catalog.test", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" } });
    const bootstrap = await authorized.request("http://catalog.test/api/bootstrap", { headers: { Host: "catalog.test", Origin: "http://catalog.test" } });
    const cookie = bootstrap.headers.get("set-cookie") ?? "";
    const read = await authorized.request("http://catalog.test/api/design-systems?limit=1", { headers: { Host: "catalog.test", Cookie: cookie } });
    const forbidden = await authorized.request("http://catalog.test/api/design-systems/missing/trash", { method: "POST", headers: { Host: "catalog.test", "content-type": "application/json" }, body: "{}" });
    const dispatched = await authorized.request("http://catalog.test/api/design-systems/missing/trash", { method: "POST", headers: { Host: "catalog.test", Origin: "http://catalog.test", "x-burnguard-capability": "catalog-test-capability", "content-type": "application/json" }, body: "{}" });

    expect([misdirected.status, optionsDenied.status, optionsAllowed.status, fetchBootstrap.status, bootstrap.status, read.status, forbidden.status, dispatched.status]).toEqual([421, 403, 204, 200, 200, 200, 403, 404]);
    expect(optionsAllowed.headers.get("access-control-allow-origin")).toBe("http://catalog.test");
    expect(await bootstrap.json()).toMatchObject({ data: { capability: "catalog-test-capability" } });
  });
});

describe("catalog query and metadata", () => {
  test("Given an unknown system When every catalog surface is called Then typed 404 responses preserve route registration", async () => {
    const missing = id("missing-catalog");
    const results = [];
    results.push(await request("GET", `/api/design-systems/${missing}`));
    results.push(await request("PATCH", `/api/design-systems/${missing}`, { expected_revision: 0, name: "missing" }));
    results.push(await request("POST", `/api/design-systems/${missing}/duplicate`, { id: `${missing}-copy`, name: "missing" }));
    results.push(await request("POST", `/api/design-systems/${missing}/trash`, {}));
    results.push(await request("POST", `/api/design-systems/${missing}/restore`, {}));
    results.push(await request("DELETE", `/api/design-systems/${missing}/purge`));

    expect(results.map((result) => result.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(results.map((result) => Reflect.get(Object(Reflect.get(Object(result.json), "error")), "code"))).toEqual(Array.from({ length: 6 }, () => "design_system_not_found"));
  });

  test("Given Unicode equivalent mixed-case tags When metadata CAS runs Then NFC lowercase tags dedupe without a content receipt", async () => {
    const systemId = await seedSystem("tags", { receipt: true });
    const before = getSqlite().query("SELECT id,status,content_revision,digest,manifest_json,provenance_json FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId);

    const result = await request("PATCH", `/api/design-systems/${systemId}`, {
      expected_revision: 0, name: "Tagged", description: null, status: "review", tags: [" É ", "e\u0301", "BRAND", "brand"],
    });

    expect(result).toMatchObject({ status: 200, json: { data: { metadata_revision: 1, status: "review", tags: ["brand", "é"] } } });
    expect(getSqlite().query("SELECT id,status,content_revision,digest,manifest_json,provenance_json FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId)).toEqual(before);
  });

  test("Given unknown and malformed facets When catalog is queried Then stable machine errors reject each boundary", async () => {
    for (const query of ["kind=nope", "owner=team", "lifecycle=deleted", "provenance=guess", "license=free", "sort=random", "direction=sideways", "limit=-1", "unknown=x"]) {
      const result = await request("GET", `/api/design-systems?${query}`);
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ error: { code: "invalid_catalog_query" } });
    }
  });

  test("Given equal sort keys When sorted Then the ID tie-break is stable", async () => {
    const z = await seedSystem("z-tie", { name: "Tie", exactId: `catalog-tie-z-${process.pid}` });
    const a = await seedSystem("a-tie", { name: "Tie", exactId: `catalog-tie-a-${process.pid}` });

    const result = await request("GET", "/api/design-systems?query=Tie&sort=name&direction=asc");

    expect(result.status).toBe(200);
    const rows = (result.json as { readonly data: readonly { readonly id: string }[] }).data.filter((row) => row.id === z || row.id === a);
    expect(rows.map((row) => row.id)).toEqual([a, z].sort());
  });

  test("Given strict metadata boundaries When unknown fields and trashed variants arrive Then typed 400 responses preserve rows", async () => {
    const systemId = await seedSystem("strict-body");
    const before = getSqlite().query("SELECT name,metadata_revision,lifecycle FROM design_systems WHERE id=?").get(systemId);

    for (const body of [
      { expected_revision: 0, unknown: true },
      { expected_revision: "0", tags: [] },
      { expected_revision: 0, tags: [1] },
      { expected_revision: 0, lifecycle: "trashed" },
    ]) {
      const result = await request("PATCH", `/api/design-systems/${systemId}`, body);
      expect(result).toMatchObject({ status: 400, json: { error: { code: "invalid_catalog_body" } } });
    }
    expect(getSqlite().query("SELECT name,metadata_revision,lifecycle FROM design_systems WHERE id=?").get(systemId)).toEqual(before);
  });

  test("Given stale metadata revision When patched Then 412 leaves metadata and tags unchanged", async () => {
    const systemId = await seedSystem("stale");
    const before = getSqlite().query("SELECT name,metadata_revision FROM design_systems WHERE id=?").get(systemId);

    const result = await request("PATCH", `/api/design-systems/${systemId}`, { expected_revision: 7, name: "Wrong", description: null, tags: ["wrong"] });

    expect(result).toMatchObject({ status: 412, json: { error: { code: "expected_revision_conflict" } } });
    expect(getSqlite().query("SELECT name,metadata_revision FROM design_systems WHERE id=?").get(systemId)).toEqual(before);
    expect(getSqlite().query("SELECT COUNT(*) count FROM design_system_tags WHERE design_system_id=?").get(systemId)).toEqual({ count: 0 });
  });

  test("Given a legacy row without metadata receipt When read Then revision zero and canonical preview fallback are returned", async () => {
    const systemId = await seedSystem("legacy");

    const result = await request("GET", `/api/design-systems/${systemId}`);

    expect(result).toMatchObject({ status: 200, json: { data: { id: systemId, metadata_revision: 0, content: { revision: 0 }, preview: { path: "README.md", fallback: true } } } });
  });

  test("Given an installed bundled system without preview files When browsing Then packaged website and thumbnail render without changing its receipt", async () => {
    const systemId = await seedSystem("bundled-preview", { exactId: "builtin-theme-timber-hall", receipt: true });
    const root = path.join(systemsDir, systemId);
    const before = await inspectCatalogTree(root);
    const rowBefore = getSqlite().query("SELECT * FROM design_systems WHERE id=?").get(systemId);
    const receiptBefore = getSqlite().query("SELECT * FROM design_system_receipts WHERE design_system_id=?").get(systemId);
    const base = `/api/design-systems/${systemId}`;
    expect(await request("GET", base)).toMatchObject({ status: 200, json: { data: { preview: { path: "preview/website.html", fallback: true }, thumbnail_path: `${base}/files/preview/thumbnail.webp` } } });
    expect(await request("GET", `${base}/previews`)).toEqual({ status: 200, json: { data: [{ path: "preview/website.html" }] } });
    const framed = await app.request(`${base}/files/preview/website.html`, { headers: { "sec-fetch-dest": "iframe" } });
    expect(framed.status).toBe(200);
    expect(framed.headers.get("content-security-policy")).toContain("frame-ancestors");
    expect(await framed.text()).toContain('href="./fonts.css"');
    const navigated = await app.request(`${base}/files/preview/website.html`, { headers: { "sec-fetch-dest": "document" } });
    expect(navigated.headers.get("content-disposition")).toContain("attachment");
    for (const file of ["thumbnail.webp", "media/timber-hall.webp"]) {
      const response = await app.request(`${base}/files/preview/${file}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(Buffer.from(await response.arrayBuffer()).toString("ascii", 8, 12)).toBe("WEBP");
    }
    const fonts = await app.request(`${base}/files/preview/fonts.css`);
    expect(fonts.headers.get("content-type")).toContain("text/css");
    expect(await fonts.text()).toMatch(/\/runtime\/fonts\/[a-f0-9]{64}\//);
    expect((await app.request(`${base}/files/preview/media/dark.webp`)).status).toBe(404);
    expect((await app.request(`${base}/files/preview/..%2F..%2FREADME.md`)).status).toBe(404);
    expect(await inspectCatalogTree(root)).toEqual(before);
    expect(getSqlite().query("SELECT * FROM design_systems WHERE id=?").get(systemId)).toEqual(rowBefore);
    expect(getSqlite().query("SELECT * FROM design_system_receipts WHERE design_system_id=?").get(systemId)).toEqual(receiptBefore);
    await mkdir(path.join(root, "preview"));
    await writeFile(path.join(root, "preview/website.html"), "<h1>Authored preview</h1>");
    expect(await (await app.request(`${base}/files/preview/website.html`)).text()).toBe("<h1>Authored preview</h1>");
  });

  test("Given persisted detail fields When catalog detail is read Then the complete runtime contract is returned", async () => {
    const systemId = await seedSystem("runtime-detail", { receipt: true });
    const dir = path.join(systemsDir, systemId);
    getSqlite().prepare(`UPDATE design_systems SET source_type='github',source_uri='https://example.test/source',lifecycle='archived',archived_at=123 WHERE id=?`).run(systemId);

    const result = await request("GET", `/api/design-systems/${systemId}`);

    expect(result).toMatchObject({ status: 200, json: { data: {
      source_type: "github", source_uri: "https://example.test/source", dir_path: dir,
      skill_md_path: path.join(dir, "SKILL.md"), tokens_css_path: path.join(dir, "colors_and_type.css"),
      readme_md_path: path.join(dir, "README.md"), archived_at: 123, lifecycle: "archived",
    } } });
  });

  test("Given committed manifest but missing bytes When read Then manifest preview fallback exposes partial state", async () => {
    const systemId = await seedSystem("missing-bytes", { receipt: true });
    await rm(path.join(systemsDir, systemId), { recursive: true });

    const result = await request("GET", `/api/design-systems/${systemId}`);

    expect(result).toMatchObject({ status: 200, json: { data: { lifecycle: "partial", preview: { path: "README.md", fallback: true }, warning: { code: "partial_operation" } } } });
  });

  test("Given a legacy name-only receipt and missing bytes When read Then preview remains available while lifecycle mutation stays unverifiable", async () => {
    const systemId = await seedSystem("legacy-missing-bytes", { receipt: true });
    getSqlite().prepare("UPDATE design_system_receipts SET manifest_json=? WHERE design_system_id=?").run(JSON.stringify({ files: ["README.md"] }), systemId);
    await rm(path.join(systemsDir, systemId), { recursive: true });

    const result = await request("GET", `/api/design-systems/${systemId}`);

    expect(result).toMatchObject({ status: 200, json: { data: { lifecycle: "partial", preview: { path: "README.md", fallback: true } } } });
  });

  test("Given a corrupt latest receipt When read Then canonical fallback remains available with partial lifecycle", async () => {
    const systemId = await seedSystem("corrupt", { receipt: true });
    getSqlite().prepare("UPDATE design_system_receipts SET manifest_json='{' WHERE design_system_id=?").run(systemId);

    const result = await request("GET", `/api/design-systems/${systemId}`);

    expect(result).toMatchObject({ status: 200, json: { data: { lifecycle: "partial", preview: { path: "README.md", fallback: true }, warning: { code: "corrupt_receipt" } } } });
  });
});

describe("catalog lineage and lifecycle", () => {
  test("Given an out-of-root catalog row When paths resolve Then containment rejects before mutation", async () => {
    await expect(catalogPaths(systemsDir, "safe-id", path.dirname(systemsDir))).rejects.toMatchObject({ code: "unsafe_catalog_path" });
    await expect(catalogPaths(systemsDir, "safe-id", path.join(systemsDir, "different-id"))).rejects.toMatchObject({ code: "unsafe_catalog_path" });
  });

  test.each(["duplicate", "derive"] as const)("Given a committed parent When %s runs Then exact digest and receipt lineage are preserved", async (operation) => {
    const parent = await seedSystem(`${operation}-parent`, { receipt: true });
    const child = id(`${operation}-child`);
    const digest = contentDigest(parent);
    const body = operation === "derive"
      ? { id: child, name: child, parent_receipt_id: `receipt-${parent}`, parent_content_digest: digest, reason: "test", metadata: { source: "catalog-test" } }
      : { id: child, name: child };

    const result = await request("POST", `/api/design-systems/${parent}/${operation}`, body);

    expect(result).toMatchObject({ status: 201, json: { data: { id: child, content: { digest }, lineage: { operation, parent_id: parent, parent_receipt_id: `receipt-${parent}`, parent_digest: digest } } } });
    expect(await readFile(path.join(systemsDir, child, "README.md"), "utf8")).toBe(`# ${parent}\n`);
  });

  test("Given a committed receipt whose digest differs from canonical bytes When duplicate runs Then typed conflict leaves rows and bytes unchanged", async () => {
    const parent = await seedSystem("digest-mismatch", { receipt: true });
    const child = id("digest-mismatch-child");
    getSqlite().prepare("UPDATE design_system_receipts SET digest='not-the-byte-digest' WHERE design_system_id=?").run(parent);
    const before = getSqlite().query("SELECT id,status,digest FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(parent);

    const result = await request("POST", `/api/design-systems/${parent}/duplicate`, { id: child, name: child });

    expect(result).toMatchObject({ status: 409, json: { error: { code: "catalog_digest_mismatch" } } });
    expect(getSqlite().query("SELECT id FROM design_systems WHERE id=?").get(child)).toBeNull();
    expect(getSqlite().query("SELECT id,status,digest FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(parent)).toEqual(before);
    expect(await readFile(path.join(systemsDir, parent, "README.md"), "utf8")).toBe(`# ${parent}\n`);
    expect(await Bun.file(path.join(systemsDir, child)).exists()).toBe(false);
  });

  test("Given any canonical tree mismatch When duplicate starts Then no child state or staging is created", async () => {
    const symlinkCapable = canCreateSymlink();
    for (const mutation of ["bytes", "extra", "missing", "symlink", "manifest-omission", "legacy-manifest"] as const) {
      // Windows refuses unprivileged symlink() with EPERM (Developer Mode / elevation
      // required); skip only this one mutation case there, everything else still runs.
      if (mutation === "symlink" && !symlinkCapable) continue;
      const systemId = await seedSystem(`tree-${mutation}`, { receipt: true });
      const child = id(`tree-${mutation}-child`);
      const dir = path.join(systemsDir, systemId);
      if (mutation === "bytes") await writeFile(path.join(dir, "README.md"), "same provenance, different bytes\n");
      if (mutation === "extra") await writeFile(path.join(dir, "extra.txt"), "extra\n");
      if (mutation === "missing") await rm(path.join(dir, "README.md"));
      if (mutation === "symlink") await symlink(path.join(dir, "README.md"), path.join(dir, "linked.md"));
      if (mutation === "manifest-omission") getSqlite().prepare("UPDATE design_system_receipts SET manifest_json=? WHERE design_system_id=?").run(JSON.stringify({ schema_version: 1, digest_algorithm: "sha256", tree_digest: "0".repeat(64), files: [] }), systemId);
      if (mutation === "legacy-manifest") getSqlite().prepare("UPDATE design_system_receipts SET manifest_json=? WHERE design_system_id=?").run(JSON.stringify({ files: ["README.md"] }), systemId);
      const before = getSqlite().query("SELECT id,status,manifest_json FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId);

      const result = await request("POST", `/api/design-systems/${systemId}/duplicate`, { id: child, name: child });

      const unverifiable = mutation === "legacy-manifest" || mutation === "manifest-omission";
      expect(result).toMatchObject({ status: 409, json: { error: { code: unverifiable ? "catalog_manifest_unverifiable" : "catalog_digest_mismatch" } } });
      expect(getSqlite().query("SELECT id FROM design_systems WHERE id=?").get(child)).toBeNull();
      expect(getSqlite().query("SELECT id,status,manifest_json FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId)).toEqual(before);
      expect(await Bun.file(path.join(systemsDir, child)).exists()).toBe(false);
      expect((await readdir(systemsDir)).some((entry) => entry.startsWith(`.${child}.catalog-staging-`))).toBe(false);
    }
  });

  test("Given active bytes differ from the receipt When trash runs Then parent and receipts remain unchanged", async () => {
    const systemId = await seedSystem("trash-byte-mismatch", { receipt: true });
    const readme = path.join(systemsDir, systemId, "README.md");
    await writeFile(readme, "mutated before trash\n");
    const before = getSqlite().query("SELECT id,status FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId);

    const result = await request("POST", `/api/design-systems/${systemId}/trash`, {});

    expect(result).toMatchObject({ status: 409, json: { error: { code: "catalog_digest_mismatch" } } });
    expect(getSqlite().query("SELECT lifecycle FROM design_systems WHERE id=?").get(systemId)).toEqual({ lifecycle: "active" });
    expect(getSqlite().query("SELECT id,status FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId)).toEqual(before);
    expect(await readFile(readme, "utf8")).toBe("mutated before trash\n");
  });

  test("Given trashed bytes differ from the receipt When restore runs Then trash and receipts remain unchanged", async () => {
    const systemId = await seedSystem("restore-byte-mismatch", { receipt: true });
    expect((await request("POST", `/api/design-systems/${systemId}/trash`, {})).status).toBe(200);
    const readme = path.join(systemsDir, ".catalog-trash", systemId, "README.md");
    await writeFile(readme, "mutated before restore\n");
    const before = getSqlite().query("SELECT id,status FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId);

    const result = await request("POST", `/api/design-systems/${systemId}/restore`, {});

    expect(result).toMatchObject({ status: 409, json: { error: { code: "catalog_digest_mismatch" } } });
    expect(getSqlite().query("SELECT lifecycle FROM design_systems WHERE id=?").get(systemId)).toEqual({ lifecycle: "trashed" });
    expect(getSqlite().query("SELECT id,status FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId)).toEqual(before);
    expect(await readFile(readme, "utf8")).toBe("mutated before restore\n");
  });

  test("Given an active project reference When trash runs Then typed 409 preserves live bytes", async () => {
    const systemId = await seedSystem("referenced", { receipt: true });
    const projectId = id("project");
    getSqlite().prepare(`INSERT INTO projects (id,name,type,design_system_id,dir_path,backend_id,created_at,updated_at)
      VALUES (?,?,'prototype',?,'/missing','codex',1,1)`).run(projectId, projectId, systemId);

    const result = await request("POST", `/api/design-systems/${systemId}/trash`, {});

    expect(result).toMatchObject({ status: 409, json: { error: { code: "has_active_projects" } } });
    expect(await readFile(path.join(systemsDir, systemId, "README.md"), "utf8")).toBe(`# ${systemId}\n`);
  });

  test("Given trash then restore When completed Then the same ID and digest return to the canonical path", async () => {
    const systemId = await seedSystem("restore", { receipt: true });
    expect((await request("POST", `/api/design-systems/${systemId}/trash`, {})).status).toBe(200);

    const restored = await request("POST", `/api/design-systems/${systemId}/restore`, {});

    expect(restored).toMatchObject({ status: 200, json: { data: { id: systemId, lifecycle: "active", content: { digest: contentDigest(systemId) } } } });
    expect(await readFile(path.join(systemsDir, systemId, "README.md"), "utf8")).toBe(`# ${systemId}\n`);
  });

  test("Given a prepared crash after live-to-trash move When recovery runs Then trash commits without lying", async () => {
    const systemId = await seedSystem("prepared", { receipt: true });
    process.env.BG_CATALOG_FAULT = `db-after-fs:trash:${systemId}`;
    const failed = await request("POST", `/api/design-systems/${systemId}/trash`, {});
    delete process.env.BG_CATALOG_FAULT;

    expect(failed.status).toBe(500);
    expect(await reconcileCatalogState(getSqlite(), systemsDir)).toMatchObject({ recovered: 1 });
    expect(await request("GET", `/api/design-systems/${systemId}`)).toMatchObject({ json: { data: { lifecycle: "trashed" } } });
  });

  test("Given stale parent digest and mutated trash bytes When restore and purge run Then both block without mutation", async () => {
    const stale = await seedSystem("stale-parent-restore", { receipt: true });
    expect((await request("POST", `/api/design-systems/${stale}/trash`, {})).status).toBe(200);
    getSqlite().prepare("UPDATE design_system_receipts SET parent_digest='stale-parent' WHERE design_system_id=? AND operation='trash'").run(stale);
    const receiptCount = getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM design_system_receipts WHERE design_system_id=?").get(stale)?.count;

    const restore = await request("POST", `/api/design-systems/${stale}/restore`, {});

    expect(restore).toMatchObject({ status: 409, json: { error: { code: "catalog_digest_mismatch" } } });
    expect(getSqlite().query("SELECT COUNT(*) count FROM design_system_receipts WHERE design_system_id=?").get(stale)).toEqual({ count: receiptCount });
    expect(await readFile(path.join(systemsDir, ".catalog-trash", stale, "README.md"), "utf8")).toBe(`# ${stale}\n`);

    const mutated = await seedSystem("mutated-purge", { receipt: true });
    expect((await request("POST", `/api/design-systems/${mutated}/trash`, {})).status).toBe(200);
    await writeFile(path.join(systemsDir, ".catalog-trash", mutated, "README.md"), "mutated before purge\n");
    const purge = await request("DELETE", `/api/design-systems/${mutated}/purge`);
    expect(purge).toMatchObject({ status: 409, json: { error: { code: "catalog_digest_mismatch" } } });
    expect(getSqlite().query("SELECT lifecycle FROM design_systems WHERE id=?").get(mutated)).toEqual({ lifecycle: "trashed" });
    expect(await readFile(path.join(systemsDir, ".catalog-trash", mutated, "README.md"), "utf8")).toBe("mutated before purge\n");
  });

  test("Given recovery sees canonical-byte mismatch When reconciling Then suspect receipt and bytes remain untouched", async () => {
    const systemId = await seedSystem("restart-mismatch", { receipt: true });
    process.env.BG_CATALOG_FAULT = `db-after-fs:trash:${systemId}`;
    expect((await request("POST", `/api/design-systems/${systemId}/trash`, {})).status).toBe(500);
    delete process.env.BG_CATALOG_FAULT;
    await writeFile(path.join(systemsDir, ".catalog-trash", systemId, "README.md"), "mutated before restart\n");
    const before = getSqlite().query("SELECT id,status,parent_digest FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId);

    const recovery = await reconcileCatalogState(getSqlite(), systemsDir);

    expect(recovery).toMatchObject({ recovered: 0, failed: 1 });
    expect(getSqlite().query("SELECT id,status,parent_digest FROM design_system_receipts WHERE design_system_id=? ORDER BY id").all(systemId)).toEqual(before);
    expect(await readFile(path.join(systemsDir, ".catalog-trash", systemId, "README.md"), "utf8")).toBe("mutated before restart\n");
  });

  test("Given purge byte removal failure When purge runs Then DB metadata and trash bytes remain", async () => {
    const systemId = await seedSystem("purge-fail", { receipt: true });
    expect((await request("POST", `/api/design-systems/${systemId}/trash`, {})).status).toBe(200);
    process.env.BG_CATALOG_FAULT = `rm:purge:${systemId}`;

    const result = await request("DELETE", `/api/design-systems/${systemId}/purge`);
    delete process.env.BG_CATALOG_FAULT;

    expect(result.status).toBe(500);
    expect(getSqlite().query("SELECT id FROM design_systems WHERE id=?").get(systemId)).toEqual({ id: systemId });
    expect(await readFile(path.join(systemsDir, ".catalog-trash", systemId, "README.md"), "utf8")).toBe(`# ${systemId}\n`);
    expect(await reconcileCatalogState(getSqlite(), systemsDir)).toMatchObject({ recovered: 1 });
  });

  test("Given bytes removed before DB failure When purge reconciles Then DB finalization completes deterministically", async () => {
    const systemId = await seedSystem("purge-db", { receipt: true });
    expect((await request("POST", `/api/design-systems/${systemId}/trash`, {})).status).toBe(200);
    process.env.BG_CATALOG_FAULT = `db-after-fs:purge:${systemId}`;
    expect((await request("DELETE", `/api/design-systems/${systemId}/purge`)).status).toBe(500);
    delete process.env.BG_CATALOG_FAULT;

    const recovery = await reconcileCatalogState(getSqlite(), systemsDir);

    expect(recovery).toMatchObject({ recovered: 1 });
    expect(getSqlite().query("SELECT id FROM design_systems WHERE id=?").get(systemId)).toBeNull();
  });

  test("Given an out-of-root DB path When trash runs Then external bytes are never moved", async () => {
    const systemId = await seedSystem("outside", { receipt: true });
    const sentinel = path.join(systemsDir, `outside-${systemId}.txt`);
    await writeFile(sentinel, "keep");
    getSqlite().prepare("UPDATE design_systems SET dir_path=? WHERE id=?").run(path.dirname(systemsDir), systemId);

    const result = await request("POST", `/api/design-systems/${systemId}/trash`, {});

    expect(result).toMatchObject({ status: 409, json: { error: { code: "unsafe_catalog_path" } } });
    expect(await readFile(sentinel, "utf8")).toBe("keep");
    await rm(sentinel, { force: true });
  });
});

function contentDigest(systemId: string): string {
  return createHash("sha256").update(JSON.stringify({ entries: [{ identity: systemId }] })).digest("hex");
}
