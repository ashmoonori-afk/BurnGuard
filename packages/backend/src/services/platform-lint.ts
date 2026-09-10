import postcss from "postcss";

export type PlatformTarget = "cafe24" | "imweb";
export type PlatformLintSeverity = "error" | "warning" | "info";
export type PlatformDocumentRole = "layout" | "page_fragment" | "common_code";

export type PlatformLintCode =
  | "cafe24_jquery_duplicate" | "cafe24_disallowed_extension" | "cafe24_file_over_30mb" | "cafe24_folder_over_1000_files" | "cafe24_korean_asset_filename" | "cafe24_unresolved_link"
  | "imweb_page_over_1m_chars" | "imweb_page_over_500k_chars" | "imweb_local_font" | "imweb_form_or_iframe" | "imweb_image_needs_hosting" | "imweb_global_selector" | "imweb_duplicate_id" | "imweb_document_script"
  | "platform_missing_asset" | "platform_invalid_markup" | "platform_unresolved_destination" | "platform_dynamic_reference";

export type PlatformLintFinding = {
  readonly code: PlatformLintCode;
  readonly severity: PlatformLintSeverity;
  readonly path: string | null;
  readonly evidence: string;
};

export type PlatformLintAsset = { readonly path: string; readonly bytes: number };
export type PlatformLintDocument = { readonly path: string; readonly text: string; readonly role: PlatformDocumentRole };
export type PlatformLintInput = {
  readonly platform: PlatformTarget;
  readonly assets: readonly PlatformLintAsset[];
  readonly documents: readonly PlatformLintDocument[];
};

/** Unverified uploader limits from doc/14 section 6 ([7] [8] [9]); every cafe24 finding stays a warning per the T07 decision. */
export const CAFE24_MAX_FILE_BYTES = 30_000_000;
export const CAFE24_MAX_FOLDER_FILES = 1_000;
const CAFE24_ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "html", "css", "js", "eot", "webp", "woff", "ttf", "otf"]);
/** Verified code-widget cap (doc/14 section 7, [13]); the soft threshold is a BurnGuard default. */
export const IMWEB_MAX_FRAGMENT_CHARS = 1_000_000;
export const IMWEB_WARN_FRAGMENT_CHARS = 500_000;
/** Per-image ceiling for data-URI inlining; base64 inflates by about a third (doc/14 section 9.3). */
export const IMWEB_INLINE_IMAGE_BUDGET_BYTES = 120_000;

export function lintForPlatform(input: PlatformLintInput): readonly PlatformLintFinding[] {
  switch (input.platform) {
    case "cafe24": return lintCafe24(input.assets, input.documents);
    case "imweb": return lintImweb(input.documents);
  }
}

export function hasBlockingFinding(findings: readonly PlatformLintFinding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

function lintCafe24(assets: readonly PlatformLintAsset[], documents: readonly PlatformLintDocument[]): readonly PlatformLintFinding[] {
  const findings: PlatformLintFinding[] = [];
  const folderCounts = new Map<string, number>();
  for (const asset of assets) {
    const extension = asset.path.slice(asset.path.lastIndexOf(".") + 1).toLowerCase();
    if (!CAFE24_ALLOWED_EXTENSIONS.has(extension)) findings.push(warn("cafe24_disallowed_extension", asset.path, `.${extension} is not in the uploader extension allowlist; upload by FTP or fall back to a system font.`));
    if (asset.bytes > CAFE24_MAX_FILE_BYTES) findings.push(warn("cafe24_file_over_30mb", asset.path, `${asset.bytes} bytes exceeds the 30MB per-file FTP limit.`));
    if ([...asset.path].some((character) => character.charCodeAt(0) > 127)) findings.push(warn("cafe24_korean_asset_filename", asset.path, "Non-ASCII asset filenames may break on the mall origin."));
    const folder = asset.path.slice(0, Math.max(0, asset.path.lastIndexOf("/")));
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }
  for (const [folder, count] of folderCounts) {
    if (count > CAFE24_MAX_FOLDER_FILES) findings.push(warn("cafe24_folder_over_1000_files", folder, `${count} files exceed the 1,000-files-per-folder cap.`));
  }
  for (const document of documents) {
    for (const source of scriptSources(document.text)) {
      if (/jquery/iu.test(source)) { findings.push(warn("cafe24_jquery_duplicate", document.path, `Smart Design already loads jQuery; ${source} risks a conflict.`)); break; }
    }
  }
  return findings;
}

function lintImweb(documents: readonly PlatformLintDocument[]): readonly PlatformLintFinding[] {
  const findings: PlatformLintFinding[] = [];
  const idOwners = new Map<string, string[]>();
  for (const document of documents) {
    if (document.role === "page_fragment") {
      const characters = [...document.text].length;
      if (characters > IMWEB_MAX_FRAGMENT_CHARS) findings.push({ code: "imweb_page_over_1m_chars", severity: "error", path: document.path, evidence: `${characters} characters exceed the 1,000,000-character code-widget cap.` });
      else if (characters > IMWEB_WARN_FRAGMENT_CHARS) findings.push(warn("imweb_page_over_500k_chars", document.path, `${characters} characters are close to the 1,000,000-character cap.`));
      for (const match of document.text.matchAll(/\bid\s*=\s*(["'])(.*?)\1/giu)) {
        const id = match[2] ?? "";
        if (id !== "") idOwners.set(id, [...idOwners.get(id) ?? [], document.path]);
      }
    }
    if (/<(?:form|iframe)\b/iu.test(document.text)) findings.push(warn("imweb_form_or_iframe", document.path, "Forms and iframes are not guaranteed to work inside a code widget."));
    if (/@font-face[^}]*url\(\s*["']?(?!data:|https:)/iu.test(document.text)) findings.push(warn("imweb_local_font", document.path, "Imweb cannot host font files; the system-font fallback applies."));
    if (/document\.(?:write|body|documentElement|addEventListener)/u.test(document.text)) findings.push(warn("imweb_document_script", document.path, "Document-wide script access affects the whole Imweb page, not only this widget."));
    if (document.role === "common_code") for (const selector of unscopedSelectors(document.text)) findings.push(warn("imweb_global_selector", document.path, `Selector ${selector} is not scoped to .bg-site.`));
  }
  for (const [id, owners] of idOwners) {
    if (owners.length > 1) findings.push(warn("imweb_duplicate_id", owners[0] ?? null, `id "${id}" appears in ${owners.length} fragments; two widgets on one page would collide.`));
  }
  return findings;
}

function scriptSources(html: string): readonly string[] {
  return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/giu)].map((match) => match[2] ?? "");
}

function unscopedSelectors(html: string): readonly string[] {
  const selectors: string[] = [];
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) {
    // `map: false`: generated CSS is re-read as untrusted text, so a sourceMappingURL comment must not read a file on this host.
    let root: postcss.Root;
    try { root = postcss.parse(match[1] ?? "", { from: undefined, map: false }); } catch { continue; }
    root.walkRules((rule) => {
      if (rule.parent instanceof postcss.AtRule && rule.parent.name.toLowerCase().endsWith("keyframes")) return;
      for (const selector of rule.selectors) if (!selector.startsWith(".bg-site")) selectors.push(selector);
    });
  }
  return selectors;
}

function warn(code: PlatformLintCode, path: string | null, evidence: string): PlatformLintFinding {
  return { code, severity: "warning", path, evidence };
}
