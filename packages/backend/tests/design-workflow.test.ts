import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DESIGN_AUDIT_CHECK_CODES, type DesignAuditResult, type NormalizedEvent } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir, projectsDir } from "../src/lib/paths";
import { createApp } from "../src/server";
import { ensureProjectDesignSystemPin, inspectProjectDesignSystemPin, readProjectDesignSystemPin } from "../src/services/project-design-system-pin";
import { blockingDesignFindings, designReviewBudgetMs, reviewTurnDesign } from "../src/services/turn-design-review";
import { auditedSiteMap } from "../src/services/design-audit";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { RenderSessionError } from "../src/services/export-render-session";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const id = `design-workflow-${process.pid}`;
const systemDir = path.join(systemsDir, id);
const projectDir = path.join(projectsDir, id);
const db = getSqlite();
const app = createApp({ capability: "workflow-test", appAuthority: "workflow.test" });
const headers = { Host: "workflow.test", Origin: "http://workflow.test", "x-burnguard-capability": "workflow-test", "content-type": "application/json" };
beforeAll(async () => {
  await mkdir(systemDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(systemDir, "colors_and_type.css"), ":root { --brand: #123456; }");
  await writeFile(path.join(systemDir, "README.md"), "# Example\n## Composition\nKeep a clear hierarchy.");
  await writeFile(path.join(projectDir, "index.html"), "<!doctype html><p>Example</p>");
  db.prepare("INSERT INTO design_systems(id,name,status,source_type,is_template,dir_path,tokens_css_path,readme_md_path,created_at,updated_at) VALUES (?,?,'published','manual',0,?,?,?,1,1)")
    .run(id, "Example", systemDir, path.join(systemDir, "colors_and_type.css"), path.join(systemDir, "README.md"));
  db.prepare("INSERT INTO projects(id,name,type,design_system_id,dir_path,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,?,'codex',1,1)").run(id, "Example", id, projectDir);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(id, id);
});
afterAll(async () => {
  db.prepare("DELETE FROM projects WHERE id=?").run(id);
  db.prepare("DELETE FROM design_systems WHERE id=?").run(id);
  for (const [root, dir] of [[systemsDir, systemDir], [projectsDir, projectDir]]) {
    if (path.dirname(dir) !== path.resolve(root)) throw new Error("Fixture escaped");
    await rm(dir, { recursive: true, force: true });
  }
});

test("Given a pinned system When its tokens change Then only an explicit idle-project update changes the baseline", async () => {
  const first = await ensureProjectDesignSystemPin(id);
  expect(first?.context).not.toContain(systemDir);
  expect(first?.context).toContain('surface="website"');
  await writeFile(path.join(systemDir, "colors_and_type.css"), ":root { --brand: #654321; }");
  expect((await ensureProjectDesignSystemPin(id))?.digest).toBe(first?.digest);
  const proposed = await inspectProjectDesignSystemPin(id);
  expect(proposed?.tokens_changed).toBe(true);
  const url = `http://workflow.test/api/projects/${id}/design-system-pin`;
  expect((await app.request(url, { method: "POST", headers, body: "{}" })).status).toBe(400);
  expect((await app.request(url, { method: "POST", headers: { Host: "workflow.test", Origin: "http://workflow.test" }, body: "{}" })).status).toBe(403);
  const body = JSON.stringify({ expected_digest: first!.digest, candidate_digest: proposed!.candidate_digest });
  db.prepare("UPDATE sessions SET status='running' WHERE id=?").run(id);
  expect((await app.request(url, { method: "POST", headers, body })).status).toBe(409);
  db.prepare("UPDATE sessions SET status='idle' WHERE id=?").run(id);
  expect((await app.request(url, { method: "POST", headers, body })).status).toBe(200);
  expect(readProjectDesignSystemPin(id)?.revision).toBe(2);
  expect(readProjectDesignSystemPin(id)?.digest).toBe(proposed!.candidate_digest);
  expect((await app.request(url, { method: "POST", headers, body })).status).toBe(409);
});

function result(blocked: boolean): DesignAuditResult {
  return { schema_version: 1, project_id: id, artifact_revision: 1, artifact_digest: "a".repeat(64), created_at: 1,
    overall_status: blocked ? "must_fix" : "ready",
    checks: DESIGN_AUDIT_CHECK_CODES.map(code => ({ code, status: blocked && code === "text_overflow" ? "fail" : "pass", reason: null,
      findings: blocked && code === "text_overflow" ? [{ id: "overflow", check_code: code, severity: "must_fix", source: { rel_path: "index.html", node_bg_id: "text" }, evidence: "overflow", targeted_action: "expand_or_reflow_text" }] : [] })),
  };
}
function reviewInput(events: NormalizedEvent[]) {
  return { projectId: id, type: "prototype" as const, entrypoint: "index.html", revision: 1, changedPaths: ["index.html"],
    adapter: { sessionId: id, turnId: id, projectDir, binaryPath: "unused", prompt: "Keep brand rules.",
      signal: new AbortController().signal, onEvent: async (event: NormalizedEvent) => { events.push(event); } },
  };
}
test("Given persistent findings When reviewing Then exactly two repairs run and the remaining failure is visible", async () => {
  let repairs = 0;
  const events: NormalizedEvent[] = [];
  const review = await reviewTurnDesign({ ...reviewInput(events), audit: async () => result(true), run: async input => {
    repairs++;
    expect(input.prompt).toContain("<design_review_findings>");
    return { exitCode: 0 };
  } });
  expect(repairs).toBe(2);
  expect(review.result?.overall_status).toBe("must_fix");
  expect(events.at(-1)).toMatchObject({ type: "tool.finished", ok: false });
});
test("Given repaired output When remeasured Then the loop stops immediately", async () => {
  let count = 0;
  const review = await reviewTurnDesign({ ...reviewInput([]), audit: async () => result(count++ === 0), run: async () => ({ exitCode: 0 }) });
  expect(review.repairs).toBe(1);
  expect(review.result?.overall_status).toBe("ready");
});
test("Given unavailable Chromium When reviewing Then no repair is charged and no success is reported", async () => {
  const events: NormalizedEvent[] = [];
  const review = await reviewTurnDesign({ ...reviewInput(events), audit: async () => { throw new RenderSessionError("chromium_not_installed", "unavailable"); }, run: async () => { throw new Error("must not run"); } });
  expect(review.status).toBe("unavailable");
  expect(review.repairs).toBe(0);
  expect(events.at(-1)).toMatchObject({ ok: false });
});

test("Given a contrast finding and design-system tokens When a repair runs Then the prompt carries the colour palette without the generation prompt", async () => {
  const prompts: string[] = [];
  const contrast = (): DesignAuditResult => ({ ...result(false), overall_status: "must_fix", checks: [{ code: "contrast", status: "fail", reason: null, findings: [{ id: "ink", check_code: "contrast", severity: "must_fix", source: { rel_path: "index.html", node_bg_id: "text" }, evidence: "4.1", targeted_action: "increase_color_contrast", measured: 4.1, threshold: 4.5 }] }] });
  await reviewTurnDesign({ ...reviewInput([]), tokensCss: "/* brand */:root { --ink: #111111; --paper: #ffffff; --space-4: 16px; --accent: rgb(10 20 30); }\n.x { --late: #000; }", audit: async () => contrast(), run: async input => { prompts.push(input.prompt); return { exitCode: 0 }; } });
  expect(prompts).toHaveLength(2);
  const palette = /<design_review_palette>\n([\s\S]*?)\n<\/design_review_palette>/u.exec(prompts[0]!)?.[1];
  expect(palette?.split("\n")).toEqual(["--ink: #111111;", "--paper: #ffffff;", "--accent: rgb(10 20 30);"]);
  expect(prompts[0]).not.toContain("Keep brand rules.");
  const overflow: string[] = [];
  await reviewTurnDesign({ ...reviewInput([]), tokensCss: ":root { --ink: #111111; }", audit: async () => result(true), run: async input => { overflow.push(input.prompt); return { exitCode: 0 }; } });
  expect(overflow).toHaveLength(2);
  expect(overflow.every(prompt => !prompt.includes("<design_review_palette>"))).toBe(true);
});

test("Given must_fix findings on changed and untouched pages When blocking findings are selected Then only changed pages and site-wide findings count", () => {
  const finding = (relPath: string, code: "contrast" | "site_nav_mismatch", severity: "must_fix" | "recommended" = "must_fix") => ({ id: `${code}:${relPath}`, check_code: code, severity, source: { rel_path: relPath, node_bg_id: null }, evidence: "fixture", targeted_action: code === "contrast" ? "increase_color_contrast" as const : "repair_site_navigation" as const });
  const audited: DesignAuditResult = { ...result(false), overall_status: "must_fix", checks: [
    { code: "contrast", status: "fail", reason: null, findings: [finding("index.html", "contrast"), finding("about.html", "contrast"), finding("pricing.html", "contrast", "recommended")] },
    { code: "site_nav_mismatch", status: "fail", reason: null, findings: [finding("about.html", "site_nav_mismatch")] },
  ] };
  expect(blockingDesignFindings(audited, ["index.html", "styles.css"]).map(item => item.id)).toEqual(["contrast:index.html", "site_nav_mismatch:about.html"]);
  expect(blockingDesignFindings(audited, ["styles.css"])).toEqual([]);
  expect(blockingDesignFindings(audited, ["about.html"]).map(item => item.id)).toEqual(["contrast:about.html", "site_nav_mismatch:about.html"]);
});

test("Given audited page counts When the review budget is derived Then it grows 20 s per further page and caps at 180 s", async () => {
  expect([0, 1, 2, 4, 7, 24].map(designReviewBudgetMs)).toEqual([60_000, 60_000, 80_000, 120_000, 180_000, 180_000]);
  const root = await mkdtemp(path.join(tmpdir(), "bg-audit-pages-"));
  try {
    await writeFile(path.join(root, "index.html"), '<nav><a href="about.html">About</a><a href="pricing.html">Pricing</a></nav>');
    await writeFile(path.join(root, "about.html"), "<p>About</p>");
    await writeFile(path.join(root, "pricing.html"), "<p>Pricing</p>");
    await writeFile(path.join(root, "styles.css"), "p{color:#111}");
    expect((await auditedSiteMap(await inspectCanonicalTree(root), root, "index.html")).pages.map(page => page.rel_path)).toEqual(["index.html", "about.html", "pricing.html"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
