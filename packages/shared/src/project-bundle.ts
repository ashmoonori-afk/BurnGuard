import { BACKEND_IDS, type BackendId, type ProjectType } from "./app";
import { isRecord, type UnknownRecord } from "./contract-parser";
import type { DesignSystemSourceType } from "./design-system";

export const PROJECT_BUNDLE_FORMAT_VERSION = 1 as const;
export const PROJECT_BUNDLE_MANIFEST_PATH = "burnguard-project.json";
export const PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS = [
  "config.json",
  "launch_capability",
  "provider_api_keys",
  "access_tokens",
] as const;

export type ProjectBundleFileKind =
  | "project"
  | "attachment"
  | "checkpoint"
  | "design_system";

export interface ProjectBundleFile {
  readonly path: string;
  readonly kind: ProjectBundleFileKind;
  readonly size_bytes: number;
  readonly sha256: string;
}

export interface ProjectBundleAttachment {
  readonly path: string;
  readonly turn_id: string | null;
  readonly mime_type: string;
  readonly original_name: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly source_role: "ordinary_content" | "immutable_reference";
  readonly source_role_explicit: boolean;
}

export interface ProjectBundleCheckpoint {
  readonly path: string;
  readonly turn_id: string;
  readonly created_at: number;
}

export interface ProjectBundleDesignSystemPin {
  readonly revision: number;
  readonly digest: string;
  readonly context: string;
  readonly tokens: string;
}

interface ProjectBundleDesignSystemBase {
  readonly pin: ProjectBundleDesignSystemPin | null;
}

export type ProjectBundleDesignSystem =
  | (ProjectBundleDesignSystemBase & { readonly kind: "none" })
  | (ProjectBundleDesignSystemBase & {
      readonly kind: "builtin";
      readonly id: string;
    })
  | (ProjectBundleDesignSystemBase & {
      readonly kind: "custom";
      readonly original_id: string;
      readonly name: string;
      readonly description: string | null;
      readonly status: "draft" | "review" | "published";
      readonly source_type: DesignSystemSourceType | null;
      readonly is_template: boolean;
      readonly skill_md_path: string | null;
      readonly tokens_css_path: string | null;
      readonly readme_md_path: string | null;
    });

export interface ProjectBundleManifest {
  readonly format: "burnguard-project";
  readonly format_version: typeof PROJECT_BUNDLE_FORMAT_VERSION;
  readonly app_version: string;
  readonly exported_at: number;
  readonly project: {
    readonly name: string;
    readonly type: ProjectType;
    readonly entrypoint: string;
    readonly backend_id: BackendId;
    readonly options_json: string | null;
    readonly current_revision: number;
    readonly current_digest: string;
  };
  readonly files: readonly ProjectBundleFile[];
  readonly attachments: readonly ProjectBundleAttachment[];
  readonly checkpoints: readonly ProjectBundleCheckpoint[];
  readonly design_system: ProjectBundleDesignSystem;
  readonly fonts: {
    readonly families: readonly string[];
    readonly files: readonly string[];
  };
  readonly credential_exclusions: typeof PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS;
}

export type ProjectBundleImportWarning =
  | { readonly code: "missing_builtin_design_system"; readonly reference: string }
  | { readonly code: "missing_font"; readonly reference: string };

export interface ProjectBundleImportResponse {
  readonly id: string;
  readonly session_id: string;
  readonly entrypoint: string;
  readonly warnings: readonly ProjectBundleImportWarning[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_TYPES = ["prototype", "slide_deck", "graphic", "logo", "from_template", "other"] as const;
const FILE_KINDS = ["project", "attachment", "checkpoint", "design_system"] as const;
const SYSTEM_STATUSES = ["draft", "review", "published"] as const;
const SOURCE_TYPES = ["sample", "github", "website", "figma", "upload", "manual"] as const;

export function parseProjectBundleManifest(input: unknown): ProjectBundleManifest {
  const root = record(input, [
    "format", "format_version", "app_version", "exported_at", "project", "files",
    "attachments", "checkpoints", "design_system", "fonts", "credential_exclusions",
  ]);
  if (root["format"] !== "burnguard-project" || root["format_version"] !== PROJECT_BUNDLE_FORMAT_VERSION) invalid();
  const project = parseProject(root["project"]);
  const files = array(root["files"]).map(parseFile);
  if (new Set(files.map((file) => canonicalPath(file.path))).size !== files.length) invalid();
  const exclusions = array(root["credential_exclusions"]);
  if (exclusions.length !== PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS.length ||
    exclusions.some((value, index) => value !== PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS[index])) invalid();
  const fonts = record(root["fonts"], ["families", "files"]);
  return {
    format: "burnguard-project",
    format_version: PROJECT_BUNDLE_FORMAT_VERSION,
    app_version: text(root["app_version"], 100),
    exported_at: integer(root["exported_at"]),
    project,
    files,
    attachments: array(root["attachments"]).map(parseAttachment),
    checkpoints: array(root["checkpoints"]).map(parseCheckpoint),
    design_system: parseDesignSystem(root["design_system"]),
    fonts: {
      families: uniqueTexts(fonts["families"], 200),
      files: uniquePaths(fonts["files"]),
    },
    credential_exclusions: PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS,
  };
}

function parseProject(input: unknown): ProjectBundleManifest["project"] {
  const value = record(input, ["name", "type", "entrypoint", "backend_id", "options_json", "current_revision", "current_digest"]);
  const type = member(value["type"], PROJECT_TYPES);
  const backend = member(value["backend_id"], BACKEND_IDS);
  const options = value["options_json"];
  if (options !== null && typeof options !== "string") invalid();
  return {
    name: text(value["name"], 200),
    type,
    entrypoint: safePath(value["entrypoint"]),
    backend_id: backend,
    options_json: options,
    current_revision: integer(value["current_revision"]),
    current_digest: digest(value["current_digest"]),
  };
}

function parseFile(input: unknown): ProjectBundleFile {
  const value = record(input, ["path", "kind", "size_bytes", "sha256"]);
  return {
    path: safePath(value["path"]),
    kind: member(value["kind"], FILE_KINDS),
    size_bytes: integer(value["size_bytes"]),
    sha256: digest(value["sha256"]),
  };
}

function parseAttachment(input: unknown): ProjectBundleAttachment {
  const value = record(input, ["path", "turn_id", "mime_type", "original_name", "size_bytes", "sha256", "source_role", "source_role_explicit"]);
  const turn = value["turn_id"];
  if (turn !== null && typeof turn !== "string") invalid();
  return {
    path: safePath(value["path"]),
    turn_id: turn,
    mime_type: text(value["mime_type"], 200),
    original_name: text(value["original_name"], 500),
    size_bytes: integer(value["size_bytes"]),
    sha256: digest(value["sha256"]),
    source_role: member(value["source_role"], ["ordinary_content", "immutable_reference"] as const),
    source_role_explicit: boolean(value["source_role_explicit"]),
  };
}

function parseCheckpoint(input: unknown): ProjectBundleCheckpoint {
  const value = record(input, ["path", "turn_id", "created_at"]);
  return { path: safePath(value["path"]), turn_id: text(value["turn_id"], 200), created_at: integer(value["created_at"]) };
}

function parsePin(input: unknown): ProjectBundleDesignSystemPin | null {
  if (input === null) return null;
  const value = record(input, ["revision", "digest", "context", "tokens"]);
  return { revision: integer(value["revision"]), digest: digest(value["digest"]), context: text(value["context"], 100_000), tokens: string(value["tokens"], 262_144) };
}

function parseDesignSystem(input: unknown): ProjectBundleDesignSystem {
  if (!isRecord(input) || typeof input["kind"] !== "string") invalid();
  if (input["kind"] === "none") {
    const value = record(input, ["kind", "pin"]);
    return { kind: "none", pin: parsePin(value["pin"]) };
  }
  if (input["kind"] === "builtin") {
    const value = record(input, ["kind", "id", "pin"]);
    return { kind: "builtin", id: text(value["id"], 200), pin: parsePin(value["pin"]) };
  }
  if (input["kind"] !== "custom") invalid();
  const value = record(input, ["kind", "original_id", "name", "description", "status", "source_type", "is_template", "skill_md_path", "tokens_css_path", "readme_md_path", "pin"]);
  const description = nullableText(value["description"], 4_000);
  const sourceType = value["source_type"] === null ? null : member(value["source_type"], SOURCE_TYPES);
  return {
    kind: "custom", original_id: text(value["original_id"], 200), name: text(value["name"], 200),
    description, status: member(value["status"], SYSTEM_STATUSES), source_type: sourceType,
    is_template: boolean(value["is_template"]), skill_md_path: nullablePath(value["skill_md_path"]),
    tokens_css_path: nullablePath(value["tokens_css_path"]), readme_md_path: nullablePath(value["readme_md_path"]),
    pin: parsePin(value["pin"]),
  };
}

function record(input: unknown, keys: readonly string[]): UnknownRecord {
  if (!isRecord(input) || Object.keys(input).length !== keys.length || keys.some((key) => !(key in input))) invalid();
  return input;
}
function array(input: unknown): readonly unknown[] { if (!Array.isArray(input) || input.length > 10_000) invalid(); return input; }
function text(input: unknown, max: number): string { if (typeof input !== "string" || !input.trim() || input.length > max) invalid(); return input; }
function string(input: unknown, max: number): string { if (typeof input !== "string" || input.length > max) invalid(); return input; }
function nullableText(input: unknown, max: number): string | null { return input === null ? null : string(input, max); }
function boolean(input: unknown): boolean { if (typeof input !== "boolean") invalid(); return input; }
function integer(input: unknown): number { if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0) invalid(); return input; }
function digest(input: unknown): string { if (typeof input !== "string" || !SHA256.test(input)) invalid(); return input; }
function member<const T extends readonly string[]>(input: unknown, values: T): T[number] { const found = values.find((value) => value === input); if (found === undefined) invalid(); return found; }
function safePath(input: unknown): string {
  const value = text(input, 1024);
  if (value.includes("\\") || value.startsWith("/") || value.normalize("NFC") !== value) invalid();
  const parts = value.split("/");
  if (parts.length > 32 || parts.some((part) => !part || part === "." || part === ".." || Array.from(part).some((character) => character.charCodeAt(0) < 32))) invalid();
  return value;
}
function nullablePath(input: unknown): string | null { return input === null ? null : safePath(input); }
function canonicalPath(value: string): string { return value.toLocaleLowerCase("en-US"); }
function uniqueTexts(input: unknown, max: number): readonly string[] {
  const values = array(input).map((value) => text(value, max));
  if (new Set(values.map((value) => value.toLocaleLowerCase("en-US"))).size !== values.length) invalid();
  return values;
}
function uniquePaths(input: unknown): readonly string[] {
  const values = array(input).map(safePath);
  if (new Set(values.map(canonicalPath)).size !== values.length) invalid();
  return values;
}
function invalid(): never { throw new Error("invalid_project_bundle_manifest"); }
