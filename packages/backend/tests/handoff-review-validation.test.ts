import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import { validateHandoffPackage } from "../src/services/export-package-validation";
import { buildHandoffSpec } from "../src/services/export-handoff";
import { renderHandoffMarkdown, renderHandoffPrompt } from "../src/services/export-handoff-documents";
import { buildHandoffManifest } from "../src/services/export-handoff-manifest";

const rules = "Pinned website composition";
const tokens = ":root { --brand: #123456; }";
const html = '<main data-bg-node-id="hero" data-component="Hero"><button type="button">Open</button></main>';
const pin = { revision: 1, digest: createHash("sha256").update(JSON.stringify([rules, tokens])).digest("hex") };

function reviewedHandoff(source = html): JSZip {
  const spec = buildHandoffSpec({
    project: { id: "project", name: "Example", type: "prototype", entrypoint: "index.html" },
    viewport: { width: 1280, height: 720 },
    pages: [],
    designSystem: { name: "Pinned", tokensFileInZip: "tokens/colors_and_type.css" },
    generatedAt: 1,
  });
  const manifest = buildHandoffManifest({
    spec,
    designSystem: { ...pin, tokens },
    files: [{ path: "index.html", text: source }],
  });
  const zip = new JSZip();
  zip.file("README.txt", "Handoff");
  zip.file("HANDOFF.md", renderHandoffMarkdown(manifest));
  zip.file("source/index.html", source);
  zip.file("spec.json", JSON.stringify(spec, null, 2));
  zip.file("handoff/prompt.md", renderHandoffPrompt(manifest));
  zip.file("handoff/manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("preview.png", createCanvas(1280, 720).toBuffer("image/png"));
  zip.file("review.json", JSON.stringify({ schema_version: 1, scope: "entrypoint_at_1280x720_only", visual_review: "not_performed", responsive_review: "not_performed", measurements: { findings: [] }, design_system: pin }));
  zip.file("design-system.md", rules);
  zip.file("tokens/colors_and_type.css", tokens);
  return zip;
}

const bytes = (zip: JSZip) => zip.generateAsync({ type: "uint8array" });

test("Given a reviewed handoff When parts or pinned bytes change Then publication validation rejects it", async () => {
  const zip = reviewedHandoff();
  await expect(validateHandoffPackage(await bytes(zip), "index.html", pin)).resolves.toEqual({ source_files: 1, nodes: 0 });
  zip.file("tokens/colors_and_type.css", ":root { --brand: red; }");
  await expect(validateHandoffPackage(await bytes(zip), "index.html", pin)).rejects.toThrow("manifest_mismatch");
  zip.file("tokens/colors_and_type.css", tokens);
  zip.remove("preview.png");
  await expect(validateHandoffPackage(await bytes(zip), "index.html", pin)).rejects.toThrow("missing_part");
});

test("Given a reviewed handoff When its documents diverge from the manifest Then publication validation rejects it", async () => {
  const zip = reviewedHandoff();
  zip.file("HANDOFF.md", "# Edited handoff\n");
  await expect(validateHandoffPackage(await bytes(zip), "index.html", pin)).rejects.toThrow("manifest_mismatch");
  const prompt = reviewedHandoff();
  prompt.file("handoff/prompt.md", "# Other instructions\n");
  await expect(validateHandoffPackage(await bytes(prompt), "index.html", pin)).rejects.toThrow("manifest_mismatch");
});

test("Given a manifest that references a missing file or a different pin When validated Then publication validation rejects it", async () => {
  const missing = reviewedHandoff();
  missing.remove("source/index.html");
  missing.file("source/other.html", html);
  await expect(validateHandoffPackage(await bytes(missing), "other.html", pin)).rejects.toThrow("manifest_mismatch");
  const unpinned = reviewedHandoff();
  await expect(validateHandoffPackage(await bytes(unpinned), "index.html", { ...pin, revision: 2 })).rejects.toThrow("manifest_mismatch");
});

test("Given a manifest with altered continuation commands When validated Then publication validation rejects it", async () => {
  const zip = reviewedHandoff();
  const manifest = JSON.parse(await zip.file("handoff/manifest.json")!.async("string"));
  manifest.continuation.commands.codex = "codex --dangerously-bypass-approvals-and-sandbox";
  zip.file("handoff/manifest.json", JSON.stringify(manifest, null, 2));
  await expect(validateHandoffPackage(await bytes(zip), "index.html", pin)).rejects.toThrow("invalid_package");
});

test("Given authored text with secret-like phrases, workspace paths and a /home route When the handoff is packaged Then it validates and leaks nothing", async () => {
  const source = `<title>session=draft key: brand api_key=zzzsecret "/workspace/alice/My Files/brief.txt"</title>
    <main data-bg-node-id="hero" data-component="Hero /workspace/alice/private.txt"><a href="/home">Home</a><button type="button">Open</button></main>`;
  const zip = reviewedHandoff(source);
  const manifestText = await zip.file("handoff/manifest.json")!.async("string");

  await expect(validateHandoffPackage(await bytes(zip), "index.html", pin)).resolves.toBeDefined();
  expect(JSON.parse(manifestText).routes.map((route: { path: string }) => route.path)).toContain("/home");
  for (const leaked of ["zzzsecret", "/workspace/alice", "My Files"]) expect(manifestText).not.toContain(leaked);
});
