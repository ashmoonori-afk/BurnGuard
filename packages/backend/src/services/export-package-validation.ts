import { createHash } from "node:crypto";
import JSZip from "jszip";
import { canonicalJson } from "./export-receipt";
import type { PackageEntryRole } from "./platform-package-contract";
import { CONTENTS_MARKER, GUIDE_PATH, IMWEB_FOOTER_PATH, IMWEB_HEADER_PATH, LAYOUT_DIRECTIVE, LAYOUT_PATH, LINT_PATH, PACKAGE_MANIFEST_PATH } from "./platform-package-roles";

export class ExportPackageError extends Error {
  readonly name = "ExportPackageError";
  constructor(readonly code: "invalid_package" | "missing_part" | "slide_mismatch" | "missing_editable_text" | "manifest_mismatch" | "unresolved_reference") { super(code); }
}

export type PlatformPackageManifest = {
  readonly schema_version: 1;
  readonly transformation_version: 1;
  readonly platform: "cafe24" | "imweb";
  readonly entrypoint: string;
  readonly project_revision: number;
  readonly project_digest: string;
  readonly options_digest: string;
  readonly asset_base_url: string | null;
  readonly external_urls: readonly string[];
  readonly roles: readonly PackageEntryRole[];
  readonly entries: readonly { readonly path: string; readonly size: number; readonly sha256: string }[];
};

/**
 * Validates a transformed platform archive against the manifest produced with it.
 * The canonical source closure cannot prove a rewritten tree, so entry digests,
 * package-relative paths, required roles and every generated reference are
 * checked here instead (doc/14 T26).
 */
export async function validatePlatformPackage(bytes: Uint8Array, expected: PlatformPackageManifest): Promise<PlatformPackageManifest> {
  const zip = await load(bytes); const names = safeNames(zip);
  for (const required of [PACKAGE_MANIFEST_PATH, GUIDE_PATH, LINT_PATH]) if (!names.has(required)) fail("missing_part");
  const texts = new Map<string, string>(); const entries: { path: string; size: number; sha256: string }[] = [];
  for (const name of [...names].sort()) {
    const content = await zip.file(name)?.async("uint8array");
    if (content === undefined) fail("missing_part");
    if (name !== PACKAGE_MANIFEST_PATH) entries.push({ path: name, size: content.length, sha256: createHash("sha256").update(content).digest("hex") });
    if (/\.(?:html|json)$/iu.test(name)) texts.set(name, new TextDecoder().decode(content));
  }
  if (texts.get(PACKAGE_MANIFEST_PATH) !== canonicalJson(expected)) fail("manifest_mismatch");
  if (JSON.stringify(entries) !== JSON.stringify([...expected.entries])) fail("manifest_mismatch");
  const paths = new Set(entries.map((entry) => entry.path));
  const roleOf = new Map(expected.roles.map((role) => [role.path, role.role]));
  for (const role of expected.roles) if (!paths.has(role.path)) fail("missing_part");
  const fragments = [...paths].filter((name) => roleOf.get(name) === "page_fragment");
  if (fragments.length === 0) fail("missing_part");
  if (expected.platform === "cafe24") validateCafe24Roles(fragments, texts, expected);
  else validateImwebRoles(fragments, texts, expected);
  return expected;
}

function validateCafe24Roles(fragments: readonly string[], texts: ReadonlyMap<string, string>, expected: PlatformPackageManifest): void {
  const paths = new Set(expected.entries.map((entry) => entry.path));
  const layout = texts.get(LAYOUT_PATH);
  if (layout === undefined || !paths.has(LAYOUT_PATH)) fail("missing_part");
  if ((layout.match(new RegExp(CONTENTS_MARKER, "gu")) ?? []).length !== 1) fail("invalid_package");
  for (const fragment of fragments) {
    const text = texts.get(fragment);
    if (text === undefined || !text.startsWith(`${LAYOUT_DIRECTIVE}\n`)) fail("invalid_package");
  }
  for (const name of [LAYOUT_PATH, ...fragments]) {
    for (const reference of packageReferences(texts.get(name) ?? "")) {
      const allowed = expected.external_urls.some((base) => reference.startsWith(base)) || paths.has(reference) || /\.html?(?:[?#].*)?$/iu.test(reference);
      if (!allowed) fail("unresolved_reference");
    }
  }
}

function validateImwebRoles(fragments: readonly string[], texts: ReadonlyMap<string, string>, expected: PlatformPackageManifest): void {
  const paths = new Set(expected.entries.map((entry) => entry.path));
  for (const required of [IMWEB_HEADER_PATH, IMWEB_FOOTER_PATH]) if (!paths.has(required)) fail("missing_part");
  for (const fragment of fragments) {
    const text = texts.get(fragment);
    if (text === undefined || /<(?:html|head|body)\b|data-bg-shared/iu.test(text)) fail("invalid_package");
    for (const reference of packageReferences(text)) {
      if (/^[a-z][a-z\d+.-]*:/iu.test(reference) && !expected.external_urls.some((base) => reference.startsWith(base))) fail("unresolved_reference");
    }
  }
}

function packageReferences(html: string): readonly string[] {
  const values = [
    // `data-*` lookalikes are excluded: a dynamic reference is a lint warning, not a broken package.
    ...[...html.matchAll(/(?<![\w-])(?:src|href|poster)\s*=\s*(["'])(.*?)\1/giu)].map((match) => match[2] ?? ""),
    ...[...html.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/giu)].map((match) => match[2] ?? ""),
    ...[...html.matchAll(/srcset\s*=\s*(["'])(.*?)\1/giu)].flatMap((match) => (match[2] ?? "").split(",").map((candidate) => candidate.trim().split(/\s+/u)[0] ?? "")),
  ];
  return values.map((value) => value.trim()).filter((value) => value !== "" && !value.startsWith("#") && !value.startsWith("data:"));
}

export async function validatePptxPackage(bytes: Uint8Array, expectedSlides: number): Promise<{ readonly slides: number; readonly editable_text_nodes: number }> {
  const zip = await load(bytes); const names = safeNames(zip);
  for (const required of ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]) if (!names.has(required)) fail("missing_part");
  const slides = [...names].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort();
  if (slides.length !== expectedSlides) fail("slide_mismatch");
  let editable = 0;
  for (const name of slides) {
    const source = await zip.file(name)?.async("string");
    if (source === undefined) fail("missing_part");
    editable += [...source.matchAll(/<a:t(?:\s[^>]*)?>[^<]+<\/a:t>/gu)].length;
  }
  if (editable === 0) fail("missing_editable_text");
  return { slides: slides.length, editable_text_nodes: editable };
}

export async function validateHandoffPackage(bytes: Uint8Array, entrypoint: string): Promise<{ readonly source_files: number; readonly nodes: number }> {
  const zip = await load(bytes); const names = safeNames(zip);
  for (const required of ["README.txt", "spec.json", `source/${entrypoint}`]) if (!names.has(required)) fail("missing_part");
  const source = await zip.file("spec.json")?.async("string"); if (source === undefined) fail("missing_part");
  let value: unknown; try { value = JSON.parse(source); } catch { fail("invalid_package"); }
  if (!isRecord(value) || value["spec_version"] !== 1 || !Array.isArray(value["pages"])) fail("invalid_package");
  let nodes = 0;
  for (const page of value["pages"]) { if (!isRecord(page) || !Array.isArray(page["nodes"])) fail("invalid_package"); nodes += page["nodes"].length; }
  return { source_files: [...names].filter((name) => name.startsWith("source/")).length, nodes };
}
async function load(bytes: Uint8Array): Promise<JSZip> { try { return await JSZip.loadAsync(bytes, { checkCRC32: true }); } catch { return fail("invalid_package"); } }
function safeNames(zip: JSZip): ReadonlySet<string> {
  const names = new Set<string>(); const canonical = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue; const name = entry.name;
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || name.normalize("NFC") !== name) fail("invalid_package");
    const key = name.toLocaleLowerCase("en-US"); if (canonical.has(key)) fail("invalid_package"); canonical.add(key); names.add(name);
  }
  return names;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(code: ExportPackageError["code"]): never { throw new ExportPackageError(code); }
