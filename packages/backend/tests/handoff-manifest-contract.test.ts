import { describe, expect, test } from "bun:test";
import { parseHandoffManifest } from "@bg/shared";

const manifest = {
  schema_version: 1,
  project: {
    id: "project-1",
    name: "Launch page",
    type: "prototype",
    entrypoint: "index.html",
  },
  design_system: {
    name: "Northvale",
    revision: 3,
    digest: "a".repeat(64),
    tokens_file: "tokens/colors_and_type.css",
    rules_file: "design-system.md",
  },
  pages: [{
    id: "page-1",
    kind: "page",
    title: "Page",
    source_path: "source/index.html",
    regions: [{
      node_id: "hero",
      tag: "section",
      component: "Hero",
      route: "/",
      token_refs: ["--color-brand"],
    }],
  }],
  routes: [{
    path: "/",
    source_file: "source/index.html",
    kind: "page",
  }],
  components: [{
    name: "Hero",
    kind: "explicit",
    source_file: "source/index.html",
    node_ids: ["hero"],
  }],
  interactions: [],
  assets: [{
    path: "source/assets/hero.webp",
    kind: "image",
  }],
  responsive_rules: [{
    source_file: "source/styles.css",
    condition: "(max-width: 768px)",
  }],
  acceptance_checks: [{
    id: "routes_resolve",
    status: "required",
    related_paths: ["source/index.html"],
  }],
  unresolved_backend_work: [],
  continuation: {
    prompt_file: "handoff/prompt.md",
    commands: {
      claude_code: 'claude --add-dir ./source "Read ./handoff/prompt.md and continue the production handoff."',
      codex: 'codex --cd ./source "Read ../handoff/prompt.md and continue the production handoff."',
    },
  },
} as const;

describe("parseHandoffManifest", () => {
  test("Given a versioned handoff manifest When parsed Then machine fields remain typed and relative", () => {
    const parsed = parseHandoffManifest(manifest);

    expect(parsed.schema_version).toBe(1);
    expect(parsed.pages[0]?.regions[0]?.node_id).toBe("hero");
    expect(parsed.pages[0]?.regions[0]?.token_refs).toEqual(["--color-brand"]);
    expect(parsed.continuation.prompt_file).toBe("handoff/prompt.md");
  });

  test("Given an absolute private source path When parsed Then the manifest is rejected", () => {
    expect(() => parseHandoffManifest({
      ...manifest,
      routes: [{ ...manifest.routes[0], source_file: "/Users/private/index.html" }],
    })).toThrow();
  });
});
