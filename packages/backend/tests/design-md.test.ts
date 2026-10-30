import { afterAll, describe, expect, test } from "bun:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { DesignMdError, parseDesignMd, renderDesignMd, type CreateDesignSystemExtractionResponse } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { systemRoutes } from "../src/routes/system";
import { classifyApiRoute } from "../src/server";
import { readDesignSystemRules } from "../src/services/design-system-rules";
import { createHash } from "node:crypto";
import { createDefaultPalette } from "@bg/shared/palette";
import { getDesignSystemDetail } from "../src/db/seed";
import { getCurrentSystemContent } from "../src/db/catalog-repository";
import { exportDesignMd, importDesignMd } from "../src/services/design-md";
import { appendDesignSystemContext } from "../src/harness/prompt-design-system";
import { ensureProjectDesignSystemPin, inspectProjectDesignSystemPin } from "../src/services/project-design-system-pin";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../src/services/design-system-palette";
import { assertSystemContentLease, withSystemContentAccess } from "../src/services/system-content-access";
import { withCatalogSnapshot } from "../src/services/catalog-snapshot";
import { projectsDir } from "../src/lib/paths";
import { tmpdir } from "node:os";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { persistCanonicalExtraction } from "../src/services/design-system-extract";

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
const projects: string[] = [];
afterAll(async () => {
  for (const id of projects) {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id);
    await fsp.rm(path.join(projectsDir, id), { recursive: true, force: true });
  }
  for (const id of created) {
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
    await fsp.rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
});

function signal() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Consumer event deadline exceeded")), milliseconds);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function consumerFixture() {
  const result = await importDesignMd({ markdown: SAMPLE, name: `consumer-${crypto.randomUUID()}` }, new AbortController().signal);
  created.push(result.system.id);
  const detail = await getDesignSystemDetail(result.system.id);
  if (detail === null) throw new Error("Missing consumer fixture");
  const projectId = `consumer-project-${crypto.randomUUID()}`;
  const dir = path.join(projectsDir, projectId);
  await fsp.mkdir(dir, { recursive: true });
  getSqlite().query(`INSERT INTO projects(id,name,type,design_system_id,dir_path,backend_id,created_at,updated_at)
    VALUES (?,?,'prototype',?,?,'codex',1,1)`).run(projectId, projectId, detail.id, dir);
  projects.push(projectId);
  return { detail, projectId };
}

async function post(body: unknown) {
  const response = await systemRoutes.fetch(new Request("http://127.0.0.1:14070/api/design-systems/import-md", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, json: await response.json() as { data?: CreateDesignSystemExtractionResponse & { rules_imported: number }; error?: { code: string } } };
}

describe("one-file design Markdown", () => {
  test("Given a v1 lineage parent When re-extraction requests its ID Then a new suffixed v1 system leaves the parent immutable", async () => {
    const source = await fsp.mkdtemp(path.join(tmpdir(), "bg-lineage-source-"));
    try {
      await fsp.writeFile(path.join(source, "tokens.css"), ":root { --brand: #123456; }\r\n");
      const signal = new AbortController().signal;
      const analysis = await analyzeLocalTree(source, "Lineage", signal);
      const input = { requestedId: `lineage-${crypto.randomUUID()}`, brandName: "Lineage", sourceType: "upload" as const, sourceReference: "fixture", analysis, signal };
      const parent = await persistCanonicalExtraction({ ...input, lineage: null });
      created.push(parent.system.id);
      const root = path.join(systemsDir, parent.system.id);
      const original = await inspectCanonicalTree(root);
      const receipt = getCurrentSystemContent(getSqlite(), parent.system.id);
      if (receipt === null) throw new Error("Missing v1 parent receipt");
      const sidecar = await fsp.readFile(path.join(root, "extraction-provenance.json"));
      const child = await persistCanonicalExtraction({ ...input, lineage: {
        operation: "re-extraction", parent_receipt_id: receipt.id, parent_content_digest: receipt.digest,
        reason: "fixture", metadata: {},
      } });
      created.push(child.system.id);
      expect(child.system.id).toBe(`${parent.system.id}-2`);
      expect(await inspectCanonicalTree(root)).toEqual(original);
      expect(await fsp.readFile(path.join(root, "extraction-provenance.json"))).toEqual(sidecar);
      expect(getCurrentSystemContent(getSqlite(), parent.system.id)).toEqual(receipt);
      expect(getCurrentSystemContent(getSqlite(), child.system.id)).toMatchObject({ schemaVersion: 1, contentRevision: 1, status: "committed" });
      expect(child.extraction.provenance.lineage).toMatchObject({ parent_receipt_id: receipt.id, parent_content_digest: receipt.digest });
    } finally { await fsp.rm(source, { recursive: true, force: true }); }
  });

  test.each(["receipt-prepared", "candidate-published", "receipt-committed"] as const)(
    "Given a real v1 creator stopped at %s When its process exits Then startup releases only its recovered reservation on the same launch",
    async boundary => {
      const home = await fsp.mkdtemp(path.join(tmpdir(), "bg-consumer-create-"));
      const output = path.join(home, "result.json");
      const probe = path.join(import.meta.dir, "fixtures/consumer-create-recovery-probe.ts");
      const environment = Object.fromEntries(["PATH", "TMPDIR", "NODE_PATH"].flatMap(key => {
        const value = process.env[key];
        return value === undefined ? [] : [[key, value]];
      }));
      const env = { ...environment, BG_APP_ROOT: path.join(home, "profile"), HOME: home, USERPROFILE: home, BG_NO_OPEN: "1" };
      const creator = Bun.spawn([process.execPath, probe, "prepare", boundary, output], {
        env, stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      const creatorExit = creator.exited;
      const creatorErrors = new Response(creator.stderr).text();
      const reader = creator.stdout.getReader();
      const run = async (phase: string) => {
        const child = Bun.spawn([process.execPath, probe, phase, boundary, output], { env, stdout: "ignore", stderr: "pipe" });
        const exited = child.exited;
        try {
          const [code, errors] = await bounded(Promise.all([exited, new Response(child.stderr).text()]), 90_000);
          expect(code, errors).toBe(0);
        } finally { child.kill(); await child.exited; }
      };
      try {
        // Given: subscribe to the emitted durable-boundary event before issuing the competing edit.
        let event = "";
        while (!event.includes("\n")) {
          const chunk = await bounded(reader.read());
          if (chunk.done) throw new Error(`Creator ended before its boundary: ${await creatorErrors}`);
          event += new TextDecoder().decode(chunk.value);
        }
        expect(event.trim()).toBe("CREATE_BOUNDARY");
        const before: unknown = JSON.parse(await fsp.readFile(output, "utf8"));
        await run("edit");
        // When: the child exits at the exact barrier, bypassing all cleanup and lock release.
        creator.stdin.write("exit\n");
        creator.stdin.end();
        expect(await bounded(creatorExit), await creatorErrors).toBe(77);
        await run("edit");
        await run("recover");
        const result: unknown = JSON.parse(await fsp.readFile(output, "utf8"));
        if (typeof before !== "object" || before === null || !("manifest" in before) || !("sidecar" in before)) {
          throw new Error("Invalid creation evidence");
        }
        // Then: ordinary access worked before a second bootstrap, and recovery preserved exact v1 bytes.
        expect(result).toMatchObject({
          before, firstHead: { schemaVersion: 1, status: "committed", contentRevision: 1 },
          head: { schemaVersion: 1, status: "committed", contentRevision: 1 },
          firstManifest: before.manifest, manifest: before.manifest, sidecar: before.sidecar,
          pending: null, marker_present: false, reservation_present: false, lock_present: false,
        });
        if (boundary !== "receipt-committed") {
          expect(result).toMatchObject({ initialLocks: { held: ["leased-v1-create"], cleared: 0 } });
        }
      } finally {
        creator.kill();
        await creatorExit;
        await reader.cancel();
        reader.releaseLock();
        await creatorErrors;
        await fsp.rm(home, { recursive: true, force: true });
      }
    }, 120_000,
  );

  test("Given an existing imported source When the same requested ID is imported Then only a suffixed v1 child is created", async () => {
    const name = `immutable-${crypto.randomUUID()}`;
    const first = await importDesignMd({ markdown: SAMPLE, name }, new AbortController().signal);
    created.push(first.system.id);
    const root = path.join(systemsDir, first.system.id);
    const original = await inspectCanonicalTree(root);
    const receipts = getSqlite().query("SELECT * FROM design_system_receipts WHERE design_system_id=? ORDER BY content_revision").all(first.system.id);
    const second = await importDesignMd({ markdown: SAMPLE, name }, new AbortController().signal);
    created.push(second.system.id);
    expect(second.system.id).toBe(`${first.system.id}-2`);
    expect(await inspectCanonicalTree(root)).toEqual(original);
    expect(getSqlite().query("SELECT * FROM design_system_receipts WHERE design_system_id=? ORDER BY content_revision").all(first.system.id)).toEqual(receipts);
    expect(getSqlite().query("SELECT schema_version,status FROM design_system_receipts WHERE design_system_id=? AND content_revision=1").get(second.system.id))
      .toEqual({ schema_version: 1, status: "committed" });
    // Follow-on rules use the existing replace adapter only after the create lease was released.
    expect(getCurrentSystemContent(getSqlite(), second.system.id)).toMatchObject({ schemaVersion: 2, contentRevision: 2, status: "committed" });
  });

  test.each(["context", "first-pin", "candidate-pin", "design-md"] as const)(
    "Given a leased %s aggregate When palette publication queues Then both snapshots retain the old legacy hash inputs",
    async kind => {
      // Given: real v1 creation followed by the existing rules adapter, not a synthetic lease.
      const { detail, projectId } = await consumerFixture();
      const env = paletteContentEnvironment();
      const before = await readDesignSystemPalette(detail.id, env);
      const originalHead = getCurrentSystemContent(getSqlite(), detail.id);
      const originalTree = await fsp.readFile(path.join(detail.dir_path, "extraction-provenance.json"));
      const entered = signal(), release = signal(), queued = signal();
      const context = async (events = {}) => {
        const lines: string[] = [];
        await appendDesignSystemContext(lines, detail, "full", "website", true, undefined, events);
        return lines.join("\n");
      };
      const originalContext = await context();
      const originalTokens = await fsp.readFile(path.join(detail.dir_path, "colors_and_type.css"), "utf8");
      const originalDigest = createHash("sha256").update(JSON.stringify([originalContext, originalTokens])).digest("hex");
      const originalMarkdown = await exportDesignMd(detail.id);
      if (kind === "candidate-pin") await ensureProjectDesignSystemPin(projectId);
      const events = { onSnapshot: async () => { entered.resolve(); await release.promise; } };
      const read: Promise<unknown> = kind === "context" ? context(events)
        : kind === "first-pin" ? ensureProjectDesignSystemPin(projectId, undefined, events)
        : kind === "candidate-pin" ? inspectProjectDesignSystemPin(projectId, events)
        : exportDesignMd(detail.id, events);
      let save: ReturnType<typeof saveDesignSystemPalette> | undefined;
      try {
        await bounded(Promise.race([entered.promise, read.then(() => { throw new Error("Missing leased aggregate event"); })]));
        // When: observe entry into the actual scheduler while the old aggregate still owns its lease.
        const pending = saveDesignSystemPalette(detail.id, { expected_digest: before.expected_digest, state: createDefaultPalette() }, env);
        save = pending;
        // A second genuine request is queued after Save; neither can acquire before release.
        const confirmation = withCatalogSnapshot(getSqlite(), systemsDir, detail.id, async lease => {
          assertSystemContentLease(lease, systemsDir, detail.id);
          return getCurrentSystemContent(getSqlite(), detail.id);
        }, { onAccessQueued: queued.resolve });
        await bounded(queued.promise);
        expect(getCurrentSystemContent(getSqlite(), detail.id)).toEqual(originalHead);
        release.resolve();
        const [published, committed] = await bounded(Promise.all([pending, confirmation]));
        expect(committed).toMatchObject({ schemaVersion: 2, id: published.receipt_id });
        expect(committed?.id).not.toBe(originalHead?.id);
      } finally { release.resolve(); }
      const result = await bounded(read);
      await save;
      // Then: palette publication has no implicit adoption or context/hash pollution.
      expect(await context()).toBe(originalContext);
      expect(await exportDesignMd(detail.id)).toEqual(originalMarkdown);
      expect((await ensureProjectDesignSystemPin(projectId))?.digest).toBe(originalDigest);
      expect((await inspectProjectDesignSystemPin(projectId))?.candidate_digest).toBe(originalDigest);
      expect(await fsp.readFile(path.join(detail.dir_path, "extraction-provenance.json"))).toEqual(originalTree);
      if (kind === "context") expect(result).toBe(originalContext);
      if (kind === "design-md") expect(result).toEqual(originalMarkdown);
      if (kind === "first-pin") expect(result).toMatchObject({ digest: originalDigest, context: originalContext, tokens: originalTokens });
      if (kind === "candidate-pin") expect(result).toMatchObject({ candidate_digest: originalDigest, tokens_changed: false, rules_changed: false });
    },
  );

  test("Given a fabricated or expired caller lease When context is assembled Then no live content is read", async () => {
    const { detail } = await consumerFixture();
    await expect(appendDesignSystemContext([], detail, "full", "website", true, { systemIds: [detail.id] }))
      .rejects.toMatchObject({ code: "system_content_unavailable" });
    let expired: Parameters<typeof appendDesignSystemContext>[5];
    await withSystemContentAccess(getSqlite(), systemsDir, [detail.id], async lease => { expired = lease; });
    if (expired === undefined) throw new Error("Missing genuine lease");
    await expect(appendDesignSystemContext([], detail, "full", "website", true, expired))
      .rejects.toMatchObject({ code: "system_content_unavailable" });
  });

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
