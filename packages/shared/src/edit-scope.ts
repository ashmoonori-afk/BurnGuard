export type EditScopeMode = "unrestricted" | "text_only" | "image_only";

export interface EditScopeTarget {
  readonly rel_path: string;
  readonly artboard_id?: string;
  readonly node_id?: string;
}

export interface EditScope {
  readonly mode: EditScopeMode;
  /** Targets are a union; fields inside each target are an intersection. */
  readonly targets?: readonly EditScopeTarget[];
}

export type RevisionChangeKind = "text" | "image" | "style" | "structure" | "script" | "asset";

export interface RevisionChange {
  readonly rel_path: string;
  readonly artboard_id: string | null;
  readonly node_id: string | null;
  readonly kind: RevisionChangeKind;
}

export interface RevisionTextChange {
  readonly node_id: string | null;
  readonly before: string;
  readonly after: string;
}

export interface RevisionComparison {
  readonly schema_version: 1;
  readonly comparison: "source";
  readonly base_digest: string;
  readonly result_digest: string;
  readonly scope: EditScope;
  readonly pages: readonly {
    readonly rel_path: string;
    readonly artboard_id: string | null;
    readonly kinds: readonly RevisionChangeKind[];
    readonly text_changes: readonly RevisionTextChange[];
  }[];
  readonly findings: readonly RevisionChange[];
}

export class EditScopeContractError extends Error {
  readonly code = "invalid_edit_scope";
  constructor() { super("invalid_edit_scope"); }
}

export function parseEditScope(value: unknown): EditScope {
  if (value === undefined) return { mode: "unrestricted" };
  if (!record(value) || Object.keys(value).some(key => key !== "mode" && key !== "targets")) throw new EditScopeContractError();
  const mode = value.mode;
  if (mode !== "unrestricted" && mode !== "text_only" && mode !== "image_only") throw new EditScopeContractError();
  if (value.targets === undefined) return { mode };
  if (!Array.isArray(value.targets) || value.targets.length === 0 || value.targets.length > 64) throw new EditScopeContractError();
  const targets = value.targets.map((target: unknown): EditScopeTarget => {
    if (!record(target) || Object.keys(target).some(key => !["rel_path", "artboard_id", "node_id"].includes(key))) throw new EditScopeContractError();
    if (!safePath(target.rel_path) || !/\.html?$/iu.test(target.rel_path)) throw new EditScopeContractError();
    for (const key of ["artboard_id", "node_id"] as const) {
      const id = target[key];
      if (id !== undefined && !safeId(id)) throw new EditScopeContractError();
    }
    return { rel_path: target.rel_path.normalize("NFC"), ...(target.artboard_id === undefined ? {} : { artboard_id: target.artboard_id as string }), ...(target.node_id === undefined ? {} : { node_id: target.node_id as string }) };
  });
  return { mode, targets };
}

export function parseRevisionComparison(value: unknown): RevisionComparison {
  if (!record(value) || value.schema_version !== 1 || value.comparison !== "source" || typeof value.base_digest !== "string" || !/^[a-f0-9]{64}$/u.test(value.base_digest) || typeof value.result_digest !== "string" || !/^[a-f0-9]{64}$/u.test(value.result_digest) || !Array.isArray(value.pages) || !Array.isArray(value.findings)) throw new EditScopeContractError();
  const scope = parseEditScope(value.scope);
  const pages = value.pages.map((page: unknown) => {
    if (!record(page) || !safePath(page.rel_path) || !nullableId(page.artboard_id) || !Array.isArray(page.kinds) || !page.kinds.every(isChangeKind) || !Array.isArray(page.text_changes)) throw new EditScopeContractError();
    const textChanges = page.text_changes.map((change: unknown): RevisionTextChange => {
      if (!record(change) || !nullableId(change.node_id) || typeof change.before !== "string" || typeof change.after !== "string") throw new EditScopeContractError();
      return { node_id: change.node_id, before: change.before, after: change.after };
    });
    return { rel_path: page.rel_path, artboard_id: page.artboard_id, kinds: page.kinds as RevisionChangeKind[], text_changes: textChanges };
  });
  return { schema_version: 1, comparison: "source", base_digest: value.base_digest, result_digest: value.result_digest, scope, pages, findings: value.findings.map(parseRevisionChange) };
}

export function parseRevisionChange(value: unknown): RevisionChange {
  if (!record(value) || !safePath(value.rel_path) || !nullableId(value.artboard_id) || !nullableId(value.node_id) || !isChangeKind(value.kind)) throw new EditScopeContractError();
  return { rel_path: value.rel_path, artboard_id: value.artboard_id, node_id: value.node_id, kind: value.kind };
}

function isChangeKind(value: unknown): value is RevisionChangeKind { return typeof value === "string" && ["text", "image", "style", "structure", "script", "asset"].includes(value); }
function safePath(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\\") && !value.startsWith("/") && value.split("/").every(part => part !== "" && part !== "." && part !== ".." && !/[:\p{Cc}]/u.test(part)); }
function safeId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128 && !/\p{Cc}/u.test(value); }
function nullableId(value: unknown): value is string | null { return value === null || safeId(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
