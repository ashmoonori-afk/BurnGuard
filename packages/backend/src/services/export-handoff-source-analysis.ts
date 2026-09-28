import { parse, type HTMLElement } from "node-html-parser";
import type { HandoffManifest } from "@bg/shared";
import { analyzeHandoffInteractions } from "./export-handoff-interactions";
import {
  isPrivatePath,
  redactPrivatePaths,
} from "./export-handoff-privacy";
import {
  handoffTokenRefs,
  responsiveRules,
} from "./export-handoff-styles";

export type HandoffSourceFile = {
  readonly path: string;
  readonly text: string | null;
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
  readonly node_context: ReadonlyMap<
    string,
    {
      readonly component: string | null;
      readonly route: string;
      readonly token_refs: readonly string[];
    }
  >;
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
): HandoffSourceAnalysis {
  const htmlFiles = files
    .filter((file) => file.text !== null && /\.html?$/iu.test(file.path))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const cssFiles = files
    .filter((file) => file.text !== null && /\.css$/iu.test(file.path))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const tokenNames = new Set(
    [...pinnedTokens.matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1] ?? ""),
  );
  const cssText = cssFiles.map((file) => file.text ?? "").join("\n");
  const routes = new Map<
    string,
    HandoffManifest["routes"][number]
  >();
  const components = new Map<
    string,
    HandoffManifest["components"][number]
  >();
  const interactions: HandoffManifest["interactions"][number][] = [];
  const unresolved: HandoffManifest["unresolved_backend_work"][number][] = [];
  const responsive: HandoffManifest["responsive_rules"][number][] =
    cssFiles.flatMap((file) => responsiveRules(file.path, file.text ?? ""));
  const sourcePages: HandoffSourceAnalysis["source_pages"][number][] = [];
  const nodeContext = new Map<
    string,
    {
      readonly component: string | null;
      readonly route: string;
      readonly token_refs: readonly string[];
    }
  >();

  for (const file of htmlFiles) {
    const sourceFile = `source/${file.path}`;
    const route = routeForHtml(file.path);
    routes.set(route, { path: route, source_file: sourceFile, kind: "page" });
    const document = parse(file.text ?? "");
    sourcePages.push({
      title: document.querySelector("title")?.text.trim() || route,
      source_path: sourceFile,
      regions: document.querySelectorAll("[data-bg-node-id]").map((element) => ({
        node_id: element.getAttribute("data-bg-node-id")?.trim() ?? "",
        tag: element.tagName.toLowerCase(),
      })).filter((region) => region.node_id !== ""),
    });
    const inlineCss = document.querySelectorAll("style")
      .map((element) => element.text)
      .join("\n");
    responsive.push(...responsiveRules(file.path, inlineCss));
    collectNodes(
      document,
      sourceFile,
      route,
      `${cssText}\n${inlineCss}`,
      tokenNames,
      components,
      nodeContext,
    );
    const interactionAnalysis = analyzeHandoffInteractions(document, sourceFile);
    interactions.push(...interactionAnalysis.interactions);
    unresolved.push(...interactionAnalysis.unresolved_backend_work);
    for (const anchor of document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href")?.trim() ?? "";
      const linkedRoute = linkedRouteFromHref(href);
      if (linkedRoute !== null && !routes.has(linkedRoute)) {
        routes.set(linkedRoute, {
          path: linkedRoute,
          source_file: sourceFile,
          kind: "linked",
        });
      }
    }
  }

  return {
    routes: [...routes.values()].sort((left, right) =>
      left.path.localeCompare(right.path, "en")
    ),
    components: [...components.values()].sort((left, right) =>
      `${left.source_file}:${left.name}`.localeCompare(
        `${right.source_file}:${right.name}`,
        "en",
      )
    ),
    interactions,
    assets: files
      .filter((file) => assetKind(file.path) !== null)
      .map((file) => ({
        path: `source/${file.path}`,
        kind: assetKind(file.path) ?? "other",
      }))
      .sort((left, right) => left.path.localeCompare(right.path, "en")),
    responsive_rules: responsive.sort((left, right) =>
      `${left.source_file}:${left.condition}`.localeCompare(
        `${right.source_file}:${right.condition}`,
        "en",
      )
    ),
    unresolved_backend_work: unresolved,
    source_pages: sourcePages,
    node_context: nodeContext,
  };
}

function collectNodes(
  document: HTMLElement,
  sourceFile: string,
  route: string,
  cssText: string,
  tokenNames: ReadonlySet<string>,
  components: Map<string, HandoffManifest["components"][number]>,
  nodeContext: Map<string, HandoffSourceAnalysis["node_context"] extends ReadonlyMap<string, infer T> ? T : never>,
): void {
  for (const element of document.querySelectorAll("[data-bg-node-id]")) {
    const nodeId = element.getAttribute("data-bg-node-id")?.trim() ?? "";
    if (nodeId === "") continue;
    const explicit =
      element.getAttribute("data-component")?.trim() ??
      element.getAttribute("data-bg-component")?.trim() ??
      "";
    const component =
      explicit !== ""
        ? redactPrivatePaths(explicit)
        : (SEMANTIC_COMPONENTS[element.tagName.toLowerCase()] ?? null);
    const tokenRefs = handoffTokenRefs(element, cssText)
      .filter((token) => tokenNames.has(token))
      .sort((left, right) => left.localeCompare(right, "en"));
    nodeContext.set(`${sourceFile}:${nodeId}`, {
      component,
      route,
      token_refs: tokenRefs,
    });
    if (component === null) continue;
    const key = `${sourceFile}:${component}`;
    const current = components.get(key);
    const nodeIds = [...new Set([...(current?.node_ids ?? []), nodeId])].sort(
      (left, right) => left.localeCompare(right, "en"),
    );
    components.set(key, {
      name: component,
      kind: explicit === "" ? "semantic" : "explicit",
      source_file: sourceFile,
      node_ids: nodeIds,
    });
  }
}

function routeForHtml(filePath: string): string {
  const withoutHtml = filePath.replace(/\.html?$/iu, "");
  const route = withoutHtml === "index"
    ? "/"
    : withoutHtml.endsWith("/index")
      ? `/${withoutHtml.slice(0, -"/index".length)}`
      : `/${withoutHtml}`;
  return route.replace(/\/+/gu, "/");
}

function linkedRouteFromHref(href: string): string | null {
  if (
    href === "" ||
    href.startsWith("#") ||
    /^[a-z][a-z\d+.-]*:/iu.test(href) ||
    href.startsWith("//")
  ) return null;
  const path = href.split(/[?#]/u)[0] ?? "";
  if (path === "" || isPrivatePath(path)) return null;
  if (path.startsWith("/")) return path;
  return routeForHtml(path);
}

function assetKind(
  filePath: string,
): HandoffManifest["assets"][number]["kind"] | null {
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(filePath)) return "image";
  if (/\.(?:otf|ttf|woff2?)$/iu.test(filePath)) return "font";
  return null;
}
