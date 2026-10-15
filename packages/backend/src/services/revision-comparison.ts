import { createHash } from "node:crypto";
import path from "node:path";
import { parse, HTMLElement, NodeType, type Node } from "node-html-parser";
import { parseEditScope, type EditScope, type RevisionChange, type RevisionChangeKind, type RevisionComparison, type RevisionTextChange } from "@bg/shared";
import { inspectCanonicalTreeOnDisk, type InspectedCanonicalTree } from "./canonical-tree-manifest";
import { readManagedFile } from "./artifact-tree-storage";

interface LocatedValue {
  readonly value: string;
  readonly nodeId: string | null;
  readonly ancestors: readonly string[];
}
interface PageInventory {
  readonly relPath: string;
  readonly artboardId: string | null;
  readonly text: Map<string, LocatedValue>;
  readonly images: Map<string, LocatedValue>;
  readonly styles: Map<string, LocatedValue>;
  readonly structure: Map<string, LocatedValue>;
}
interface Inventory {
  readonly tree: InspectedCanonicalTree;
  readonly pages: Map<string, PageInventory>;
  readonly assetUses: Map<string, { page: PageInventory; location: LocatedValue }[]>;
}
const IMAGE_FILE = /\.(?:png|jpe?g|webp|gif|avif|svg|ico|bmp)$/iu;
const IMAGE_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = { IMG: ["src", "srcset"], SOURCE: ["src", "srcset"], VIDEO: ["poster"], IMAGE: ["href", "xlink:href"], INPUT: ["src"] };

export class EditScopeViolationError extends Error {
  readonly code = "edit_scope_violation";
  constructor(readonly findings: readonly RevisionChange[], readonly comparison: RevisionComparison) { super("edit_scope_violation"); }
}

export async function compareRevisionTrees(baseRoot: string, resultRoot: string, editScope?: EditScope): Promise<RevisionComparison> {
  const scope = parseEditScope(editScope);
  const before = await inventory(baseRoot, scope.mode !== "unrestricted");
  const after = await inventory(resultRoot, scope.mode !== "unrestricted");
  const changes: { change: RevisionChange; location: LocatedValue; text?: RevisionTextChange }[] = [];
  const add = (page: PageInventory, kind: RevisionChangeKind, location: LocatedValue, text?: RevisionTextChange) => {
    changes.push({ change: { rel_path: page.relPath, artboard_id: page.artboardId, node_id: location.nodeId, kind }, location, ...(text === undefined ? {} : { text }) });
  };
  for (const key of [...new Set([...before.pages.keys(), ...after.pages.keys()])].sort()) {
    const previous = before.pages.get(key), next = after.pages.get(key), page = next ?? previous!;
    for (const [field, kind] of [["text", "text"], ["images", "image"], ["styles", "style"], ["structure", "structure"]] as const) {
      const oldValues = previous?.[field] ?? new Map<string, LocatedValue>();
      const newValues = next?.[field] ?? new Map<string, LocatedValue>();
      for (const locator of [...new Set([...oldValues.keys(), ...newValues.keys()])].sort()) {
        const oldValue = oldValues.get(locator), newValue = newValues.get(locator);
        if (oldValue?.value === newValue?.value) continue;
        const location = newValue ?? oldValue!;
        add(page, kind, location, kind === "text" ? { node_id: location.nodeId, before: oldValue?.value ?? "", after: newValue?.value ?? "" } : undefined);
      }
    }
  }
  const oldFiles = new Map(before.tree.manifest.files.map(file => [file.path, file.sha256]));
  const newFiles = new Map(after.tree.manifest.files.map(file => [file.path, file.sha256]));
  for (const file of [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()) {
    if (oldFiles.get(file) === newFiles.get(file) || /\.html?$/iu.test(file)) continue;
    const kind: RevisionChangeKind = /\.css$/iu.test(file) ? "style" : /\.[cm]?js$/iu.test(file) ? "script" : IMAGE_FILE.test(file) ? "image" : "asset";
    const uses = [...(before.assetUses.get(file) ?? []), ...(after.assetUses.get(file) ?? [])];
    if (uses.length > 0) for (const use of uses) add(use.page, kind, use.location);
    else add({ relPath: file, artboardId: null, text: new Map(), images: new Map(), styles: new Map(), structure: new Map() }, kind, { value: "", nodeId: null, ancestors: [] });
  }
  const findings = scope.mode === "unrestricted" ? [] : changes.filter(({ change, location }) => {
    const allowedKind = scope.mode === "text_only" ? "text" : "image";
    if (change.kind !== allowedKind) return true;
    // Unreferenced asset bytes cannot be attributed to an allowed page or node.
    if (!/\.html?$/iu.test(change.rel_path)) return true;
    return !matchesTarget(scope, change, location);
  }).map(item => item.change);
  const pages = new Map<string, { rel_path: string; artboard_id: string | null; kinds: Set<RevisionChangeKind>; text_changes: RevisionTextChange[] }>();
  for (const { change, text } of changes) {
    const key = JSON.stringify([change.rel_path, change.artboard_id]);
    let page = pages.get(key);
    if (!page) { page = { rel_path: change.rel_path, artboard_id: change.artboard_id, kinds: new Set(), text_changes: [] }; pages.set(key, page); }
    page.kinds.add(change.kind);
    if (text) page.text_changes.push(text);
  }
  const uniqueFindings = [...new Map(findings.map(finding => [JSON.stringify(finding), finding])).values()];
  return { schema_version: 1, comparison: "source", base_digest: before.tree.manifest.tree_digest, result_digest: after.tree.manifest.tree_digest, scope,
    pages: [...pages.values()].sort((a, b) => order(JSON.stringify([a.rel_path, a.artboard_id]), JSON.stringify([b.rel_path, b.artboard_id]))).map(page => ({ ...page, kinds: [...page.kinds].sort() })), findings: uniqueFindings };
}

export function assertEditScope(comparison: RevisionComparison): void {
  if (comparison.findings.length > 0) throw new EditScopeViolationError(comparison.findings, comparison);
}

function matchesTarget(scope: EditScope, change: RevisionChange, location: LocatedValue): boolean {
  return scope.targets === undefined || scope.targets.some(target => target.rel_path === change.rel_path && (target.artboard_id === undefined || target.artboard_id === change.artboard_id) && (target.node_id === undefined || location.ancestors.includes(target.node_id)));
}

async function inventory(root: string, strictEncoding: boolean): Promise<Inventory> {
  const tree = await inspectCanonicalTreeOnDisk(root);
  const pages = new Map<string, PageInventory>();
  const assetUses: Inventory["assetUses"] = new Map();
  for (const file of tree.manifest.files.filter(file => /\.html?$/iu.test(file.path))) {
    const source = new TextDecoder("utf-8", { fatal: strictEncoding }).decode(await readManagedFile(root, file, {}, tree.diskPaths));
    const document = parse(source, { comment: false });
    let artboardIndex = 0;
    const pageFor = (artboardId: string | null): PageInventory => {
      const key = JSON.stringify([file.path, artboardId]);
      let page = pages.get(key);
      if (!page) { page = { relPath: file.path, artboardId, text: new Map(), images: new Map(), styles: new Map(), structure: new Map() }; pages.set(key, page); }
      return page;
    };
    pageFor(null).structure.set("declaration", { value: source.match(/^\s*<!doctype[^>]*>/iu)?.[0].trim() ?? "", nodeId: null, ancestors: [] });
    const useAsset = (reference: string, page: PageInventory, location: LocatedValue) => {
      const resolved = resolveRevisionReference(file.path, reference);
      if (resolved === null) return;
      const uses = assetUses.get(resolved) ?? [];
      uses.push({ page, location }); assetUses.set(resolved, uses);
    };
    const walk = (node: Node, locator: string, page: PageInventory, ancestors: readonly string[], hidden: boolean): void => {
      if (node.nodeType === NodeType.TEXT_NODE) {
        const value = normalizeText(node.textContent);
        if (value !== "") (hidden ? page.structure : page.text).set(locator, { value, nodeId: ancestors.at(-1) ?? null, ancestors });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const tag = node.tagName ?? "ROOT";
      const id = node.getAttribute("data-bg-node-id");
      const ids = id ? [...ancestors, id] : ancestors;
      const invisible = hidden || ["HEAD", "TEMPLATE", "NOSCRIPT"].includes(tag) || node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true" || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/iu.test(node.getAttribute("style") ?? "");
      const isBoard = node.hasAttribute("data-slide") || node.hasAttribute("data-graphic-artboard") || node.hasAttribute("data-bg-artboard");
      if (isBoard) {
        artboardIndex++;
        page = pageFor(id || node.getAttribute("data-graphic-artboard") || node.getAttribute("data-bg-artboard") || node.getAttribute("id") || `artboard-${artboardIndex}`);
      }
      const location: LocatedValue = { value: "", nodeId: id ?? ids.at(-1) ?? null, ancestors: ids };
      const attributes = { ...node.attributes };
      const imageAttrs = tag === "INPUT" && node.getAttribute("type") !== "image" ? [] : IMAGE_ATTRIBUTES[tag] ?? [];
      for (const name of imageAttrs) {
        const reference = node.getAttribute(name);
        if (reference === undefined) continue;
        page.images.set(`${locator}@${name}`, { ...location, value: reference });
        delete attributes[name];
        if (name === "srcset") for (const candidate of reference.split(",")) useAsset(candidate.trim().split(/\s+/u)[0] ?? "", page, location);
        else useAsset(reference, page, location);
      }
      for (const name of ["alt", "title", "aria-label", "placeholder", "value"]) {
        if (invisible || ["STYLE", "SCRIPT", "LINK"].includes(tag)) break;
        if (attributes[name] === undefined || (name === "value" && tag !== "INPUT")) continue;
        page.text.set(`${locator}@${name}`, { ...location, value: normalizeText(attributes[name]) });
        delete attributes[name];
      }
      if (attributes.style !== undefined) { page.styles.set(`${locator}@style`, { ...location, value: attributes.style }); delete attributes.style; }
      if (tag === "STYLE") { page.styles.set(locator, { ...location, value: JSON.stringify([attributes, node.innerHTML]) }); return; }
      if (tag === "SCRIPT") { page.structure.set(locator, { ...location, value: digest(node.toString()) }); return; }
      // Every other attribute, tag, order and element identity is immutable in restricted edits.
      page.structure.set(locator, { ...location, value: JSON.stringify([tag, Object.keys(attributes).sort().map(key => [key, attributes[key]])]) });
      for (const attr of ["href", "src", "data", "poster"]) {
        const ref = node.getAttribute(attr);
        if (ref !== undefined && !imageAttrs.includes(attr)) useAsset(ref, page, location);
      }
      let elementIndex = 0, textIndex = 0;
      for (const child of node.childNodes) {
        const suffix = child.nodeType === NodeType.TEXT_NODE ? `text-${textIndex++}` : `element-${elementIndex++}`;
        walk(child, `${locator}/${suffix}`, page, ids, invisible);
      }
    };
    walk(document, "root", pageFor(null), [], false);
  }
  return { tree, pages, assetUses };
}

/** HTML references use URL slashes, independent of the host's filesystem separators. */
export function resolveRevisionReference(relativePage: string, reference: string): string | null {
  if (reference === "" || reference.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(reference) || reference.includes("\\")) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(reference.split(/[?#]/u)[0] ?? ""); } catch { return null; }
  const resolved = path.posix.normalize(decoded.startsWith("/") ? decoded.slice(1) : path.posix.join(path.posix.dirname(relativePage), decoded));
  return resolved === ".." || resolved.startsWith("../") ? null : resolved.normalize("NFC");
}

function normalizeText(text: string): string { return text.normalize("NFC").replace(/\s+/gu, " ").trim(); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function order(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
