import {
  decodeContract,
  isRecord,
  requiredArray,
  requiredNumber,
  requiredRecord,
  requiredString,
  stringArray,
  UpgradeContractError,
  type UnknownRecord,
} from "./contract-parser";
import type { ProjectType } from "./app";
import type {
  HandoffManifest,
  HandoffRegion,
} from "./handoff";

const PROJECT_TYPES: readonly ProjectType[] = [
  "prototype",
  "slide_deck",
  "graphic",
  "logo",
  "from_template",
  "other",
];

export function parseHandoffManifest(input: unknown): HandoffManifest {
  const root = decodeContract(input);
  if (root["schema_version"] !== 1) invalid("schema_version");
  exact(root, [
    "schema_version",
    "project",
    "design_system",
    "pages",
    "routes",
    "components",
    "interactions",
    "assets",
    "responsive_rules",
    "acceptance_checks",
    "unresolved_backend_work",
    "continuation",
  ]);
  const project = requiredRecord(root, "project");
  exact(project, ["id", "name", "type", "entrypoint"]);
  const projectType = oneOf(project, "type", PROJECT_TYPES);
  const designSystem = requiredRecord(root, "design_system");
  exact(designSystem, ["name", "revision", "digest", "tokens_file", "rules_file"]);
  return {
    schema_version: 1,
    project: {
      id: requiredString(project, "id"),
      name: requiredString(project, "name"),
      type: projectType,
      entrypoint: relativePath(project, "entrypoint"),
    },
    design_system: {
      name: nullableString(designSystem, "name"),
      revision: nullableNumber(designSystem, "revision"),
      digest: nullableDigest(designSystem, "digest"),
      tokens_file: nullablePath(designSystem, "tokens_file"),
      rules_file: nullablePath(designSystem, "rules_file"),
    },
    pages: objectArray(root, "pages", parsePage),
    routes: objectArray(root, "routes", parseRoute),
    components: objectArray(root, "components", parseComponent),
    interactions: objectArray(root, "interactions", parseInteraction),
    assets: objectArray(root, "assets", parseAsset),
    responsive_rules: objectArray(root, "responsive_rules", parseResponsiveRule),
    acceptance_checks: objectArray(root, "acceptance_checks", parseAcceptanceCheck),
    unresolved_backend_work: objectArray(root, "unresolved_backend_work", parseBackendWork),
    continuation: parseContinuation(requiredRecord(root, "continuation")),
  };
}

function parsePage(value: UnknownRecord) {
  exact(value, ["id", "kind", "title", "source_path", "regions"]);
  const kind = oneOf(value, "kind", ["page", "slide", "artboard"] as const);
  return {
    id: requiredString(value, "id"),
    kind,
    title: requiredString(value, "title"),
    source_path: relativePath(value, "source_path"),
    regions: objectArray(value, "regions", parseRegion),
  };
}

function parseRegion(value: UnknownRecord): HandoffRegion {
  exact(value, ["node_id", "tag", "component", "route", "token_refs"]);
  return {
    node_id: requiredString(value, "node_id"),
    tag: requiredString(value, "tag"),
    component: nullableString(value, "component"),
    route: nullableString(value, "route"),
    token_refs: stringArray(value, "token_refs"),
  };
}

function parseRoute(value: UnknownRecord) {
  exact(value, ["path", "source_file", "kind"]);
  return {
    path: requiredString(value, "path"),
    source_file: relativePath(value, "source_file"),
    kind: oneOf(value, "kind", ["page", "linked"] as const),
  };
}

function parseComponent(value: UnknownRecord) {
  exact(value, ["name", "kind", "source_file", "node_ids"]);
  return {
    name: requiredString(value, "name"),
    kind: oneOf(value, "kind", ["explicit", "semantic"] as const),
    source_file: relativePath(value, "source_file"),
    node_ids: stringArray(value, "node_ids"),
  };
}

function parseInteraction(value: UnknownRecord) {
  exact(value, ["id", "kind", "label", "source_file", "node_id", "target", "status"]);
  return {
    id: requiredString(value, "id"),
    kind: oneOf(value, "kind", ["link", "button", "form"] as const),
    label: nullableString(value, "label"),
    source_file: relativePath(value, "source_file"),
    node_id: nullableString(value, "node_id"),
    target: nullableString(value, "target"),
    status: oneOf(value, "status", ["implemented", "mocked"] as const),
  };
}

function parseAsset(value: UnknownRecord) {
  exact(value, ["path", "kind"]);
  return {
    path: relativePath(value, "path"),
    kind: oneOf(value, "kind", ["image", "font", "stylesheet", "script", "other"] as const),
  };
}

function parseResponsiveRule(value: UnknownRecord) {
  exact(value, ["source_file", "condition"]);
  return {
    source_file: relativePath(value, "source_file"),
    condition: requiredString(value, "condition"),
  };
}

function parseAcceptanceCheck(value: UnknownRecord) {
  exact(value, ["id", "status", "related_paths"]);
  return {
    id: requiredString(value, "id"),
    status: oneOf(value, "status", ["required", "unverified"] as const),
    related_paths: stringArray(value, "related_paths").map((item, index) =>
      assertRelativePath(item, `related_paths.${index}`),
    ),
  };
}

function parseBackendWork(value: UnknownRecord) {
  exact(value, ["id", "interaction_id", "source_file", "node_id", "reason"]);
  return {
    id: requiredString(value, "id"),
    interaction_id: requiredString(value, "interaction_id"),
    source_file: relativePath(value, "source_file"),
    node_id: nullableString(value, "node_id"),
    reason: oneOf(value, "reason", ["button_without_handler", "form_without_backend"] as const),
  };
}

function parseContinuation(value: UnknownRecord) {
  exact(value, ["prompt_file", "commands"]);
  const commands = requiredRecord(value, "commands");
  exact(commands, ["claude_code", "codex"]);
  return {
    prompt_file: relativePath(value, "prompt_file"),
    commands: {
      claude_code: requiredString(commands, "claude_code"),
      codex: requiredString(commands, "codex"),
    },
  };
}

function objectArray<T>(
  record: UnknownRecord,
  key: string,
  parseItem: (value: UnknownRecord) => T,
): readonly T[] {
  return requiredArray(record, key).map((item, index) => {
    if (!isRecord(item)) invalid(`${key}.${index}`);
    return parseItem(item);
  });
}

function oneOf<const T extends readonly string[]>(
  record: UnknownRecord,
  key: string,
  values: T,
): T[number] {
  const value = requiredString(record, key);
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) invalid(key);
  return match;
}

function nullableString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) invalid(key);
  return value;
}

function nullableNumber(record: UnknownRecord, key: string): number | null {
  if (record[key] === null) return null;
  return requiredNumber(record, key);
}

function nullableDigest(record: UnknownRecord, key: string): string | null {
  const value = nullableString(record, key);
  if (value !== null && !/^[a-f\d]{64}$/u.test(value)) invalid(key);
  return value;
}

function nullablePath(record: UnknownRecord, key: string): string | null {
  const value = nullableString(record, key);
  return value === null ? null : assertRelativePath(value, key);
}

function relativePath(record: UnknownRecord, key: string): string {
  return assertRelativePath(requiredString(record, key), key);
}

function assertRelativePath(value: string, key: string): string {
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    invalid(key);
  }
  return value;
}

function exact(record: UnknownRecord, keys: readonly string[]): void {
  for (const key of Object.keys(record)) if (!keys.includes(key)) invalid(key);
}

function invalid(path: string): never {
  throw new UpgradeContractError("invalid_field", path);
}
