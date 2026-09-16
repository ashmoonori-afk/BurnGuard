import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import { validateHandoffPackage } from "../src/services/export-package-validation";

test("Given a reviewed handoff When parts or pinned bytes change Then publication validation rejects it", async () => {
  const rules = "Pinned website composition";
  const tokens = ":root { --brand: #123456; }";
  const pin = { revision: 1, digest: createHash("sha256").update(JSON.stringify([rules, tokens])).digest("hex") };
  const zip = new JSZip();
  zip.file("README.txt", "Handoff");
  zip.file("source/index.html", "<p>Example</p>");
  zip.file("spec.json", JSON.stringify({ spec_version: 1, pages: [] }));
  zip.file("preview.png", createCanvas(1280, 720).toBuffer("image/png"));
  zip.file("review.json", JSON.stringify({ schema_version: 1, scope: "entrypoint_at_1280x720_only", visual_review: "not_performed", responsive_review: "not_performed", measurements: { findings: [] }, design_system: pin }));
  zip.file("design-system.md", rules);
  zip.file("tokens/colors_and_type.css", tokens);
  const bytes = () => zip.generateAsync({ type: "uint8array" });
  await expect(validateHandoffPackage(await bytes(), "index.html", pin)).resolves.toEqual({ source_files: 1, nodes: 0 });
  zip.file("tokens/colors_and_type.css", ":root { --brand: red; }");
  await expect(validateHandoffPackage(await bytes(), "index.html", pin)).rejects.toThrow("manifest_mismatch");
  zip.file("tokens/colors_and_type.css", tokens);
  zip.remove("preview.png");
  await expect(validateHandoffPackage(await bytes(), "index.html", pin)).rejects.toThrow("missing_part");
});
