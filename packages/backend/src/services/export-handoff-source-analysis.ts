import path from "node:path";
import { parse, type HTMLElement } from "node-html-parser";
import type { HandoffManifest } from "@bg/shared";
import { analyzeHandoffInteractions } from "./export-handoff-interactions";
import { compareCodeUnits } from "./export-handoff-order";
import { sanitizeHandoffText, sanitizeNullableHandoffText } from "./export-handoff-privacy";
import {
  inlineTokenRefs,
  mapPageTokens,
  parseHandoffStylesheet,
  HANDOFF_STYLE_LIMITS,
  type HandoffStylesheet,
} from "./export-handoff-styles";

export const HANDOFF_ANALYSIS_LIMITS = {
  htmlFiles: 200,
  nodesPerPage: 5_000,
  interactions: 2_000,
} as const;

export type HandoffSourceFile = {
  readonly path: string;
  readonly text: string | null;
};

export type HandoffNodeContext = {
  readonly component: string | null;
  readonly route: string;
  readonly token_refs: readonly string[];
};

export type HandoffSourceAnalysis = Pick<
  HandoffManifest,
  | "routes"
  | "components"
  | "interactions"
  | "assets"
  | "responsive_rules"
  | "unresolved_backend_work"
> & {
  readonly source_pages: readonly {
    readonly title: string;
    readonly source_path: string;
    readonly regions: readonly {
      readonly node_id: string;
      readonly tag: string;
    }[];
  }[];
  readonly node_context: ReadonlyMap<string, HandoffNodeContext>;
};

const SEMANTIC_COMPONENTS: Readonly<Record<string, string>> = {
  a: "Link",
  button: "Button",
  footer: "Footer",
  form: "Form",
  header: "Header",
  input: "Input",
  main: "Main",
  nav: "Navigation",
  select: "Select",
  textarea: "Textarea",
};

export function analyzeHandoffSources(
  files: readonly HandoffSourceFile[],
  pinnedTokens: string,
  signal?: AbortSignal,
): HandoffSourceAnalysis {
  const htmlFiles = files
    .filter((file) => file.text !== null && /\.html?$/iu.test(file.path))
    .sort((left, right) => compareCodeUnits(left.path, right.path))
    .slice(0, HANDOFF_ANALYSIS_LIMITS.htmlFiles);
  const htmlPaths = new Set(htmlFiles.map((file) => file.path));
  const stylesheets = new Map<string, HandoffStylesheet>();
  for (const file of files) {
    if (file.text === null || !/\.css$/iu.test(file.path)) continue;
    signal?.throwIfAborted();
    stylesheets.set(file.path, parseHandoffStylesheet(`source/${file.path}`, file.text));
  }
  const tokenNames = new Set(
    [...pinnedTokens.matchAll(/(--[\w-]+)\s*:/gu)].flatMap((match) => match[1] === undefined ? [] : [match[1]]),
  );
  const routes = new Map<string, HandoffManifest["routes"][number]>();
  const components = new Map<string, HandoffManifest["components"][number]>();
  const interactions: HandoffManifest["interactions"][number][] = [];
  const unresolved: HandoffManifest["unresolved_backend_work"][number][] = [];
  const responsive: HandoffManifest["responsive_rules"][number][] = [...stylesheets.values()].flatMap((sheet) => sheet.responsive);
  const sourcePages: HandoffSourceAnalysis["source_pages"][number][] = [];
  const nodeContext = new Map<string, HandoffNodeContext>();

  for (const file of htmlFiles) {
    signal?.throwIfAborted();
    const sourceFile = `source/${file.path}`;
    const route = routeForHtml(file.path);
    routes.set(route, { path: route, source_file: sourceFile, kind: "page" });
    const document = parse(file.text ?? "");
    const inlineSheets = document.querySelectorAll("style").map((element) => parseHandoffStylesheet(sourceFile, element.text));
    responsive.push(...inlineSheets.flatMap((sheet) => sheet.responsive));
    const linkedSheets = document.querySelectorAll("link[href]")
      .filter((element) => /(?:^|\s)stylesheet(?:\s|$)/iu.test(element.getAttribute("rel") ?? ""))
      .flatMap((element) => {
        const resolved = resolveLocalReference(file.path, element.getAttribute("href") ?? "");
        const sheet = resolved === null ? undefined : stylesheets.get(resolved);
        return sheet === undefined ? [] : [sheet];
      });
    const pageTokens = mapPageTokens(document, [...linkedSheets, ...inlineSheets], tokenNames);
    const nodes = document.querySelectorAll("[data-bg-node-id]").slice(0, HANDOFF_ANALYSIS_LIMITS.nodesPerPage);
    sourcePages.push({
      title: sanitizeNullableHandoffText(document.querySelector("title")?.text) ?? route,
      source_path: sourceFile,
      regions: nodes.flatMap((element) => {
        const nodeId = nodeIdOf(element);
        return nodeId === null ? [] : [{ node_id: nodeId, tag: element.tagName.toLowerCase() }];
      }),
    });
    collectNodes(nodes, sourceFile, route, pageTokens, tokenNames, components, nodeContext);
    if (interactions.length < HANDOFF_ANALYSIS_LIMITS.interactions) {
      const analysis = analyzeHandoffInteractions(document, sourceFile);
      const room = HANDOFF_ANALYSIS_LIMITS.interactions - interactions.length;
      const kept = analysis.interactions.slice(0, room);
      const keptIds = new Set(kept.map((interaction) => interaction.id));
      interactions.push(...kept);
      unresolved.push(...analysis.unresolved_backend_work.filter((item) => keptIds.has(item.interaction_id)));
    }
    for (const anchor of document.querySelectorAll("a[href]")) {
      const linkedRoute = linkedRouteFromHref(file.path, anchor.getAttribute("href") ?? "", htmlPaths);
      if (linkedRoute !== null && !routes.has(linkedRoute)) {
        routes.set(linkedRoute, { path: linkedRoute, source_file: sourceFile, kind: "linked" });
      }
    }
  }

  return {
    routes: [...routes.values()].sort((left, right) => compareCodeUnits(left.path, right.path)),
    components: [...components.values()].sort((left, right) =>
      compareCodeUnits(`${left.source_file}:${left.name}`, `${right.source_file}:${right.name}`)
    ),
    interactions,
    assets: files
      .flatMap((file) => {
        const kind = assetKind(file.path);
        return kind === null ? [] : [{ path: `source/${file.path}`, kind }];
      })
      .sort((left, right) => compareCodeUnits(left.path, right.path)),
    responsive_rules: responsive.sort((left, right) =>
      compareCodeUnits(`${left.source_file}:${left.condition}`, `${right.source_file}:${right.condition}`)
    ),
    unresolved_backend_work: unresolved,
    source_pages: sourcePages,
    node_context: nodeContext,
  };
}

function collectNodes(
  nodes: readonly HTMLElement[],
  sourceFile: string,
  route: string,
  pageTokens: ReadonlyMap<string, readonly string[]>,
  tokenNames: ReadonlySet<string>,
  components: Map<string, HandoffManifest["components"][number]>,
  nodeContext: Map<string, HandoffNodeContext>,
): void {
  for (const element of nodes) {
    const nodeId = nodeIdOf(element);
    if (nodeId === null) continue;
    const explicit = sanitizeNullableHandoffText(
      element.getAttribute("data-component") ?? element.getAttribute("data-bg-component"),
      120,
    );
    const component = explicit ?? SEMANTIC_COMPONENTS[element.tagName.toLowerCase()] ?? null;
    const tokenRefs = [...new Set([
      ...(pageTokens.get(nodeId) ?? []),
      ...inlineTokenRefs(element).filter((token) => tokenNames.has(token)),
    ])].sort(compareCodeUnits).slice(0, HANDOFF_STYLE_LIMITS.tokensPerRegion);
    nodeContext.set(`${sourceFile}:${nodeId}`, { component, route, token_refs: tokenRefs });
    if (component === null) continue;
    const key = `${sourceFile}:${component}`;
    const current = components.get(key);
    components.set(key, {
      name: component,
      kind: explicit === null ? "semantic" : "explicit",
      source_file: sourceFile,
      node_ids: [...new Set([...(current?.node_ids ?? []), nodeId])].sort(compareCodeUnits),
    });
  }
}

function nodeIdOf(element: HTMLElement): string | null {
  return sanitizeNullableHandoffText(element.getAttribute("data-bg-node-id"), 120);
}

export function routeForHtml(filePath: string): string {
  const withoutHtml = filePath.replace(/\.html?$/iu, "");
  const route = withoutHtml === "index"
    ? "/"
    : withoutHtml.endsWith("/index")
      ? `/${withoutHtml.slice(0, -"/index".length)}`
      : `/${withoutHtml}`;
  return route.replace(/\/+/gu, "/");
}

/** Resolves a local href against its owning file ("" = site root); null for external, undecodable or escaping references. */
function resolveLocalReference(owner: string, href: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//") || /^[a-z][a-z\d+.-]*:/iu.test(trimmed)) return null;
  const pathPart = trimmed.split(/[?#]/u)[0] ?? "";
  if (pathPart === "") return null;
  let decoded: string;
  try { decoded = decodeURIComponent(pathPart); }
  catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  if (decoded.includes("\\")) return null;
  const joined = decoded.startsWith("/")
    ? path.posix.normalize(decoded).replace(/^\/+/u, "")
    : path.posix.normalize(path.posix.join(path.posix.dirname(owner), decoded));
  if (joined === "" || joined === "." || joined === ".." || joined.startsWith("../")) return decoded.startsWith("/") ? "" : null;
  return joined;
}

function linkedRouteFromHref(owner: string, href: string, htmlPaths: ReadonlySet<string>): string | null {
  const resolved = resolveLocalReference(owner, href);
  if (resolved === null) return null;
  if (resolved === "") return "/";
  if (htmlPaths.has(resolved)) return routeForHtml(resolved);
  if (htmlPaths.has(`${resolved}.html`)) return routeForHtml(`${resolved}.html`);
  if (htmlPaths.has(`${resolved.replace(/\/$/u, "")}/index.html`)) return routeForHtml(`${resolved.replace(/\/$/u, "")}/index.html`);
  if (path.posix.extname(resolved) !== "") return null;
  const route = sanitizeHandoffText(`/${resolved.replace(/\/$/u, "")}`, 160);
  return route.includes("<") ? null : route;
}

function assetKind(filePath: string): HandoffManifest["assets"][number]["kind"] | null {
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(filePath)) return "image";
  if (/\.(?:otf|ttf|woff2?)$/iu.test(filePath)) return "font";
  return null;
}
