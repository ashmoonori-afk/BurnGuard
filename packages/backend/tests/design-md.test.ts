import { afterAll, describe, expect, test } from "bun:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { DesignMdError, parseDesignMd, renderDesignMd, type CreateDesignSystemExtractionResponse } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { systemRoutes } from "../src/routes/system";
import { classifyApiRoute } from "../src/server";
import { readDesignSystemRules } from "../src/services/design-system-rules";

const SAMPLE = [
  "---",
  "name: Harbor Studio",
  "description: Calm editorial system for a ferry operator",
  "colors:",
  '  brand-primary: "#0B3D5C"',
  "  surface: '#F7F4EE'",
  "typography:",
  '  font-display: "Fraunces, serif"',
  "spacing:",
  "  space-4: 16px",
  "radius:",
  "  radius-md: 8px",
  "---",
  "",
  "# Harbor Studio",
  "",
  "## Visual theme",
  "Quiet, generous whitespace.",
  "",
  "## Do's and Don'ts",
  "### Do",
  "- Accent colour only on actions",
  "### Don't",
  "- No gradients",
  "- Don't: no drop shadows on cards",
  "",
].join("\n");

const created: string[] = [];
afterAll(async () => {
  for (const id of created) {
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
    await fsp.rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
});

async function post(body: unknown) {
  const response = await systemRoutes.fetch(new Request("http://127.0.0.1:14070/api/design-systems/import-md", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, json: await response.json() as { data?: CreateDesignSystemExtractionResponse & { rules_imported: number }; error?: { code: string } } };
}

describe("one-file design Markdown", () => {
  test("Given the import and export endpoints When classified Then both reach the system routes", () => {
    expect(classifyApiRoute("/api/design-systems/import-md", "POST")).toBe("system");
    expect(classifyApiRoute("/api/design-systems/abc/design-md", "GET")).toBe("system");
  });

  test("Given a design file When parsed Then tokens, sections and both rule lists are read", () => {
    const doc = parseDesignMd(SAMPLE);
    expect(doc.name).toBe("Harbor Studio");
    expect(doc.tokens.colors).toEqual({ "brand-primary": "#0B3D5C", surface: "#F7F4EE" });
    expect(doc.tokens.typography).toEqual({ "font-display": "Fraunces, serif" });
    expect([doc.tokens.spacing, doc.tokens.radius]).toEqual([{ "space-4": "16px" }, { "radius-md": "8px" }]);
    expect(doc.dos).toEqual(["Accent colour only on actions"]);
    expect(doc.donts).toEqual(["No gradients", "no drop shadows on cards"]);
    expect(doc.sections.map((section) => section.heading)).toContain("Visual theme");
  });

  test("Given a rendered file When parsed again Then every token and rule survives", () => {
    const doc = parseDesignMd(SAMPLE);
    const again = parseDesignMd(renderDesignMd(doc));
    expect([again.name, again.tokens, again.dos, again.donts]).toEqual([doc.name, doc.tokens, doc.dos, doc.donts]);
  });

  test("Given values YAML would misread When rendered Then they are quoted so any YAML reader gets the same string", () => {
    const rendered = renderDesignMd({ ...parseDesignMd(SAMPLE), tokens: { colors: { brand: "#0B3D5C" }, typography: {}, spacing: { gap: "16px" }, radius: {}, shadows: {}, tokens: { ratio: "16 / 10", label: "a: b" } } });
    expect(rendered).toContain('brand: "#0B3D5C"');
    expect(rendered).toContain('gap: "16px"');
    expect(rendered).toContain('label: "a: b"');
  });

  test("Given font stacks with quoted family names When exported and imported again Then the values survive unchanged", () => {
    const doc = { ...parseDesignMd(SAMPLE), tokens: { colors: {}, typography: { "font-sans": '"DM Sans", sans-serif', "font-display": "'Iowan Old Style', serif" }, spacing: {}, radius: {}, shadows: {}, tokens: {} } };
    expect(parseDesignMd(renderDesignMd(doc)).tokens.typography).toEqual(doc.tokens.typography);
  });

  test("Given malformed, empty, oversized or injected input When parsed Then it is refused or the unsafe value is dropped", () => {
    expect(() => parseDesignMd("---\nname: x\n")).toThrow(DesignMdError);
    expect(() => parseDesignMd("just text")).toThrow(DesignMdError);
    expect(() => parseDesignMd("x".repeat(256 * 1024 + 1))).toThrow(DesignMdError);
    const injected = parseDesignMd("---\ncolors:\n  evil: \"red;} body{display:none\"\n  ok: '#fff'\n---\n## A\ntext\n");
    expect(injected.tokens.colors).toEqual({ ok: "#fff" });
  });

  test("Given a design file When imported through the API Then a draft system is created with its rules marked imported, and it exports back as Markdown", async () => {
    const result = await post({ markdown: SAMPLE, name: `Harbor ${process.pid}` });
    expect(result.status).toBe(201);
    const system = result.json.data!.system;
    created.push(system.id);
    expect(system.status).toBe("draft");
    expect(result.json.data!.rules_imported).toBe(3);
    const rules = await readDesignSystemRules({ dir_path: path.join(systemsDir, system.id) });
    expect(rules.rules.map((rule) => [rule.kind, rule.origin.type])).toEqual([["do", "imported"], ["dont", "imported"], ["dont", "imported"]]);
    const tokensPath = system.tokens_css_path!;
    const css = await fsp.readFile(path.isAbsolute(tokensPath) ? tokensPath : path.join(systemsDir, system.id, tokensPath), "utf8");
    expect(css).toContain("#0B3D5C".toLowerCase());

    const exported = await systemRoutes.fetch(new Request(`http://127.0.0.1:14070/api/design-systems/${system.id}/design-md`));
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/markdown");
    const doc = parseDesignMd(await exported.text());
    expect(doc.name).toBe(`Harbor ${process.pid}`);
    expect(doc.dos).toEqual(["Accent colour only on actions"]);
    expect(doc.donts).toEqual(["No gradients", "no drop shadows on cards"]);
  });

  test("Given invalid requests When importing or exporting Then stable codes are returned", async () => {
    expect((await post({ markdown: 3 })).json.error?.code).toBe("design_md_invalid");
    expect((await post({ markdown: "plain words" })).json.error?.code).toBe("design_md_empty");
    expect((await post([])).status).toBe(400);
    const missing = await systemRoutes.fetch(new Request("http://127.0.0.1:14070/api/design-systems/no-such-system/design-md"));
    expect(missing.status).toBe(404);
  });
});
