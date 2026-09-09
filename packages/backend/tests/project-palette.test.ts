import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { paletteHtml } from "../src/services/project-palette";
import { artifactOperationRoutes } from "../src/routes/artifact-operations";
import { classifyApiRoute } from "../src/server";

const id = `palette-${process.pid}`;
const root = path.join(projectsDir, id);
const source = `<!doctype html><style>:root { --brand: #abc; } h1{color:#aabbcc;background:url("icon.svg#abc");border-color:#abcd;content:"#abc"}</style><script>const color = '#abc';</script><p title="style='#abc'" style="color: #ABC; background: #ffffff">#abc</p>`;

afterAll(async () => { getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id); await rm(root, { recursive: true, force: true }); });

describe("project palette", () => {
  test("Given declaration colors mixed with scripts prose strings URLs and alpha When replaced Then only opaque declaration colors change", () => {
    const colors = new Map();
    const output = paletteHtml(source, colors, { color: "#aabbcc", value: "#123456" });
    expect(output).toBe(source.replace("--brand: #abc", "--brand: #123456").replace("color:#aabbcc", "color:#123456").replace("color: #ABC", "color: #123456"));
    expect(colors.get("#aabbcc").count).toBe(3);
    expect(colors.has("#abcd")).toBe(false);
    const mapped = '<style>a{color:#abc}/*# sourceMappingURL=data:application/json;base64,bm90LWpzb24= */</style>';
    expect(paletteHtml(mapped, new Map(), { color: "#aabbcc", value: "#123456" })).toBe(mapped.replace("color:#abc", "color:#123456"));
  });

  test("Given a page and linked stylesheet When palette is patched Then stale updates fail and undo restores exact bytes", async () => {
    await mkdir(root, { recursive: true });
    const html = `<link rel="stylesheet" href="theme.css"><link rel="stylesheet" href=".attachments/reference.css">${source}`;
    const css = "/* #abc */ .card { box-shadow: 0 0 2px #abc; background: url('image.svg#abc'); }";
    await writeFile(path.join(root, "index.html"), html);
    await writeFile(path.join(root, "theme.css"), css);
    await mkdir(path.join(root, "pages"));
    await writeFile(path.join(root, "pages", "about.html"), '<link rel="stylesheet" href="/theme.css"><p>About</p>');
    await mkdir(path.join(root, ".attachments"));
    await writeFile(path.join(root, ".attachments", "reference.css"), "p { color: #abc; }");
    getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?, 'prototype',?,'index.html','codex',1,1)").run(id, id, root);
    const coordinator = new ArtifactCoordinator(getSqlite());
    const base = await coordinator.initialize(id, root);
    const url = `http://local/api/projects/${id}/palette`;
    expect(classifyApiRoute(`/api/projects/${id}/palette`, "GET")).toBe("artifact-operations");
    const listed = await artifactOperationRoutes.request(url);
    expect(listed.status).toBe(200);
    const palette = (await listed.json()).data;
    expect(palette.files).toEqual(["index.html", "theme.css"]);
    expect((await (await artifactOperationRoutes.request(`${url}?path=pages/about.html`)).json()).data.files).toEqual(["pages/about.html", "theme.css"]);
    expect(palette.colors.find((color: { value: string }) => color.value === "#aabbcc").count).toBe(4);
    const body = { rel_path: "index.html", expected_revision: 0, expected_artifact_digest: base.tree_digest, color: "#aabbcc", value: "#123456" };
    const patch = () => artifactOperationRoutes.request(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const response = await patch();
    expect(response.status).toBe(200);
    const result = (await response.json()).data;
    expect(result.diff.map((entry: { path: string }) => entry.path).sort()).toEqual(["index.html", "theme.css"]);
    expect(await readFile(path.join(root, "theme.css"), "utf8")).toBe(css.replace("2px #abc", "2px #123456"));
    expect(await readFile(path.join(root, ".attachments", "reference.css"), "utf8")).toBe("p { color: #abc; }");
    expect((await patch()).status).toBe(409);
    await coordinator.undo({ projectId: id, projectDir: root, operationId: result.operation_id, expectedRevision: result.result_revision, expectedArtifactDigest: result.result_digest });
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(html);
    expect(await readFile(path.join(root, "theme.css"), "utf8")).toBe(css);
    expect((await artifactOperationRoutes.request(`${url}?path=../outside.html`)).status).toBe(422);
    expect((await artifactOperationRoutes.request(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, value: "red;display:none" }) })).status).toBe(400);
  });
});
