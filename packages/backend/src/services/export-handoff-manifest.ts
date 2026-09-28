import {
  HANDOFF_CONTINUATION,
  parseHandoffManifest,
  type HandoffManifest,
  type HandoffSpec,
} from "@bg/shared";
import {
  analyzeHandoffSources,
  type HandoffSourceFile,
} from "./export-handoff-source-analysis";
import { redactPrivatePaths } from "./export-handoff-privacy";

export type HandoffManifestInput = {
  readonly spec: HandoffSpec;
  readonly designSystem: {
    readonly revision: number;
    readonly digest: string;
    readonly tokens: string;
  } | null;
  readonly files: readonly HandoffSourceFile[];
};

export function buildHandoffManifest(
  input: HandoffManifestInput,
): HandoffManifest {
  const analysis = analyzeHandoffSources(
    input.files,
    input.designSystem?.tokens ?? "",
  );
  const sourcePath = `source/${input.spec.project.entrypoint}`;
  const renderedPages = input.spec.pages.map((page, index) => ({
    id: `page-${index + 1}`,
    kind: input.spec.project.type === "slide_deck"
      ? "slide" as const
      : input.spec.project.type === "graphic"
        ? "artboard" as const
        : "page" as const,
    title: page.title,
    source_path: sourcePath,
    regions: page.nodes.map((node) => {
      const context = analysis.node_context.get(`${sourcePath}:${node.bg_id}`);
      return {
        node_id: node.bg_id,
        tag: node.tag,
        component: context?.component ?? null,
        route: context?.route ?? routeForEntrypoint(input.spec.project.entrypoint),
        token_refs: context?.token_refs ?? [],
      };
    }),
  }));
  const staticPages = analysis.source_pages
    .filter((page) => page.source_path !== sourcePath)
    .map((page, index) => ({
      id: `page-${renderedPages.length + index + 1}`,
      kind: "page" as const,
      title: page.title,
      source_path: page.source_path,
      regions: page.regions.map((region) => {
        const context = analysis.node_context.get(
          `${page.source_path}:${region.node_id}`,
        );
        return {
          node_id: region.node_id,
          tag: region.tag,
          component: context?.component ?? null,
          route: context?.route ?? null,
          token_refs: context?.token_refs ?? [],
        };
      }),
    }));
  const relatedSourcePaths = input.files
    .filter((file) => /\.html?$/iu.test(file.path))
    .map((file) => `source/${file.path}`)
    .sort((left, right) => left.localeCompare(right, "en"));
  const responsivePaths = [
    ...new Set(analysis.responsive_rules.map((rule) => rule.source_file)),
  ].sort((left, right) => left.localeCompare(right, "en"));
  return parseHandoffManifest({
    schema_version: 1,
    project: {
      ...input.spec.project,
      name: redactPrivatePaths(input.spec.project.name),
    },
    design_system: {
      name: input.spec.design_system.name === null
        ? null
        : redactPrivatePaths(input.spec.design_system.name),
      revision: input.designSystem?.revision ?? null,
      digest: input.designSystem?.digest ?? null,
      tokens_file: input.spec.design_system.tokens_file,
      rules_file: input.designSystem === null ? null : "design-system.md",
    },
    pages: [...renderedPages, ...staticPages],
    routes: analysis.routes,
    components: analysis.components,
    interactions: analysis.interactions,
    assets: analysis.assets,
    responsive_rules: analysis.responsive_rules,
    acceptance_checks: [
      {
        id: "routes_resolve",
        status: "required",
        related_paths: relatedSourcePaths,
      },
      {
        id: "assets_resolve",
        status: "required",
        related_paths: analysis.assets.map((asset) => asset.path),
      },
      {
        id: "responsive_layout",
        status: "unverified",
        related_paths: responsivePaths,
      },
      {
        id: "keyboard_navigation",
        status: "unverified",
        related_paths: relatedSourcePaths,
      },
      {
        id: "backend_integrations",
        status: analysis.unresolved_backend_work.length === 0
          ? "unverified"
          : "required",
        related_paths: [
          ...new Set(
            analysis.unresolved_backend_work.map((item) => item.source_file),
          ),
        ].sort((left, right) => left.localeCompare(right, "en")),
      },
    ],
    unresolved_backend_work: analysis.unresolved_backend_work,
    continuation: HANDOFF_CONTINUATION,
  });
}

function routeForEntrypoint(entrypoint: string): string {
  const withoutHtml = entrypoint.replace(/\.html?$/iu, "");
  if (withoutHtml === "index") return "/";
  return `/${withoutHtml.replace(/\/index$/u, "")}`.replace(/\/+/gu, "/");
}
