import { describe, expect, test } from "bun:test";
import { parseUxReviewReport } from "@bg/shared";
import { reviewHtml } from "../src/services/ux-review";
import { fingerprintHtmlNode } from "../src/services/file-patch";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectsDir } from "../src/lib/paths";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { artifactRoutes } from "../src/routes/artifacts";
import { classifyApiRoute, createApp } from "../src/server";

describe("local UX review", () => {
  test("Given a review URL, When the capability is absent, Then server rejects before dispatch", async () => {
    const url = "/api/projects/missing/ux-review";
    expect(classifyApiRoute(url, "GET")).toBe("artifacts");
    const app = createApp({ capability: "ux-test-capability", appAuthority: "127.0.0.1:14070" });
    expect((await app.request(new Request(`http://127.0.0.1:14070${url}`, { headers: { host: "127.0.0.1:14070" } }))).status).toBe(403);
  });
  test("Given semantic issues, When reviewing, Then reports bounded findings with canonical anchors", () => {
    const html = '<h1>Title</h1><h3>Details</h3><button>확인</button><select><option>A</option></select><a href="/">더 보기</a><img src="x"><p>' + "설명".repeat(300) + "</p>";
    const findings = reviewHtml(html, "prototype");
    expect(findings.map((finding) => finding.code)).toEqual(["heading_jump", "action_name", "input_label", "link_name", "image_alt", "long_paragraph"]);
    for (const finding of findings) expect(fingerprintHtmlNode(html, finding.node_bg_id!).fingerprint).toBeTruthy();
    expect(reviewHtml("<img>".repeat(100), "graphic")).toHaveLength(40);
    const report = { schema_version: 1, project_id: "project", artifact_revision: 1, artifact_digest: "a".repeat(64), source_path: "index.html", basis: "local_html_heuristics", limitations: ["Static only"], findings };
    expect(parseUxReviewReport(report)).toEqual(report);
    expect(() => parseUxReviewReport({ ...report, source_path: "../private.html" })).toThrow();
    expect(() => parseUxReviewReport({ ...report, artifact_digest: "bad" })).toThrow();
    expect(() => parseUxReviewReport({ ...report, extra: true })).toThrow();
    expect(() => parseUxReviewReport({ ...report, artifact_revision: -1 })).toThrow();
    expect(() => parseUxReviewReport({ ...report, artifact_revision: 0.5 })).toThrow();
    expect(() => reviewHtml("<div>".repeat(102) + "</div>".repeat(102), "graphic")).toThrow();
  });
  test("Given labels, decorative images and hidden content, When reviewing, Then respects semantics and project kind", () => {
    expect(reviewHtml('<h1>Title</h1><label for="x">Name</label><input id="x"><span id="label">Country</span><select aria-labelledby="label"><option>A</option></select><img alt=""><a href="/"><img alt="Home"></a><div hidden><button></button></div>', "prototype")).toEqual([]);
    expect(reviewHtml("<p>Short slide</p>", "slide_deck")).toEqual([]);
    expect(reviewHtml('<img data-bg-node-id="same"><img data-bg-node-id="same">', "graphic").every((finding) => finding.node_bg_id === null)).toBe(true);
  });
  test("Given canonical project identity, When route receives traversal or stale bytes, Then rejects safely", async () => {
    await runMigrations();
    await mkdir(projectsDir, { recursive: true });
    const dir = await mkdtemp(path.join(projectsDir, "ux-review-test-"));
    const id = path.basename(dir);
    try {
      await writeFile(path.join(dir, "index.html"), "<h1>Title</h1><img>");
      const manifest = await inspectCanonicalTree(dir);
      getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at,current_revision,current_digest) VALUES (?,?,'prototype',?,'index.html','codex',1,1,0,?)").run(id, id, dir, manifest.tree_digest);
      const url = `http://local/api/projects/${id}/ux-review`;
      const response = await artifactRoutes.request(url);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(parseUxReviewReport(body.data).artifact_digest).toBe(manifest.tree_digest);
      expect((await artifactRoutes.request(url + "?path=..%2Fprivate.html")).status).toBe(400);
      expect((await artifactRoutes.request(url + "?path=index.html&path=other.html")).status).toBe(400);
      expect((await artifactRoutes.request(url + "?unknown=1")).status).toBe(400);
      await writeFile(path.join(dir, "index.html"), "<h1>Changed</h1>");
      expect((await artifactRoutes.request(url)).status).toBe(409);
    } finally {
      getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id);
      // The mkdtemp result is a child of the explicitly named managed project root.
      if (path.dirname(dir) === path.resolve(projectsDir)) await rm(dir, { recursive: true, force: true });
    }
  });
});
