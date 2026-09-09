import { copyFile, cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { isProjectDocumentPath } from "./project-document-paths";

const HANDOFF_EXCLUDED_TOP_LEVEL = new Set([".meta", ".attachments", ".burnguard-inputs"]);

/**
 * Recursively copies a staged project directory into the handoff
 * bundle's `source/` folder, skipping reserved top-level entries
 * (`.meta/`, `.attachments/`) so checkpoint snapshots and user
 * uploads don't leak into the handoff zip. Exposed so tests can
 * exercise the exclusion rule without a browser in the loop.
 */
export async function copyProjectIntoBundle(
  stagedProjectDir: string,
  bundleSourceDir: string,
): Promise<{ copied: string[]; skipped: string[] }> {
  await mkdir(bundleSourceDir, { recursive: true });
  const copied: string[] = [];
  const skipped: string[] = [];
  const entries = await readdir(stagedProjectDir, { withFileTypes: true });
  for (const entry of entries) {
    if (HANDOFF_EXCLUDED_TOP_LEVEL.has(entry.name)) {
      skipped.push(entry.name);
      continue;
    }
    const src = path.join(stagedProjectDir, entry.name);
    const dest = path.join(bundleSourceDir, entry.name);
    if (entry.isDirectory()) {
      await cp(src, dest, { recursive: true, filter: (source) => !isProjectDocumentPath(path.relative(stagedProjectDir, source)) });
    } else if (entry.isFile()) {
      await copyFile(src, dest);
    }
    copied.push(entry.name);
  }
  return { copied, skipped };
}

export class HandoffExportError extends Error {
  readonly code:
    | "chromium_not_installed"
    | "chromium_launch_timeout"
    | "artifact_not_ready"
    | "render_failed";

  constructor(code: HandoffExportError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** Properties bundled for every data-bg-node-id element. */
export const HANDOFF_STYLE_KEYS = [
  "display",
  "position",
  "top",
  "left",
  "width",
  "height",
  "padding",
  "margin",
  "border",
  "border-radius",
  "background",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
] as const;

export interface HandoffNode {
  bg_id: string;
  tag: string;
  parent_bg_id: string | null;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  styles: Partial<Record<(typeof HANDOFF_STYLE_KEYS)[number], string>>;
}

export interface HandoffPage {
  slide_index: number | null;
  title: string;
  rect: { w: number; h: number };
  nodes: HandoffNode[];
}

export interface HandoffSpec {
  spec_version: 1;
  generated_at: number;
  project: {
    id: string;
    name: string;
    type: "prototype" | "slide_deck" | "graphic" | "from_template" | "other";
    entrypoint: string;
  };
  viewport: { width: number; height: number };
  design_system: {
    name: string | null;
    tokens_file: string | null; // relative path inside the zip
  };
  pages: HandoffPage[];
}

/**
 * Pure assembler — takes the raw `page.evaluate` payload and the project
 * metadata, returns a `HandoffSpec`. Split out so tests can exercise it
 * without launching chromium.
 */
export function buildHandoffSpec(input: {
  project: HandoffSpec["project"];
  viewport: { width: number; height: number };
  pages: HandoffPage[];
  designSystem: { name: string | null; tokensFileInZip: string | null };
  generatedAt?: number;
}): HandoffSpec {
  return {
    spec_version: 1,
    generated_at: input.generatedAt ?? Date.now(),
    project: input.project,
    viewport: input.viewport,
    design_system: {
      name: input.designSystem.name,
      tokens_file: input.designSystem.tokensFileInZip,
    },
    pages: input.pages,
  };
}

/**
 * Runs inside the browser. Extracts every `data-bg-node-id` element's
 * geometry + styles + text + parent linkage. For slide-decks, groups
 * into one page per `[data-slide]` with rects relative to the slide.
 * For non-deck artifacts, returns a single page containing the whole
 * document with rects relative to the viewport.
 */
export const EXTRACT_HANDOFF_FN = `() => {
  const STYLE_KEYS = ${JSON.stringify(HANDOFF_STYLE_KEYS)};

  function styleSubset(el) {
    const cs = window.getComputedStyle(el);
    const out = {};
    for (const key of STYLE_KEYS) {
      out[key] = cs.getPropertyValue(key).trim();
    }
    return out;
  }

  function directText(el) {
    const parts = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.textContent) {
        parts.push(child.textContent);
      }
    }
    return parts.join("").replace(/\\s+/g, " ").trim();
  }

  function parentBgId(el, root) {
    let cur = el.parentElement;
    while (cur && cur !== root) {
      const id = cur.getAttribute && cur.getAttribute("data-bg-node-id");
      if (id) return id;
      cur = cur.parentElement;
    }
    return null;
  }

  function extractNodes(root, relativeTo) {
    const baseRect = relativeTo.getBoundingClientRect();
    const out = [];
    const els = root.querySelectorAll("[data-bg-node-id]");
    els.forEach((el) => {
      const rect = el.getBoundingClientRect();
      out.push({
        bg_id: el.getAttribute("data-bg-node-id") || "",
        tag: el.tagName.toLowerCase(),
        parent_bg_id: parentBgId(el, relativeTo),
        text: directText(el),
        rect: {
          x: Math.round((rect.left - baseRect.left) * 100) / 100,
          y: Math.round((rect.top - baseRect.top) * 100) / 100,
          w: Math.round(rect.width * 100) / 100,
          h: Math.round(rect.height * 100) / 100,
        },
        styles: styleSubset(el),
      });
    });
    return out;
  }

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const slides = document.querySelectorAll("[data-slide]");
  if (slides.length > 0) {
    return {
      viewport,
      pages: Array.from(slides).map((slide, i) => {
        const rect = slide.getBoundingClientRect();
        return {
          slide_index: i,
          title: "Slide " + (i + 1),
          rect: {
            w: Math.round(rect.width * 100) / 100,
            h: Math.round(rect.height * 100) / 100,
          },
          nodes: extractNodes(slide, slide),
        };
      }),
    };
  }
  const rootRect = document.documentElement.getBoundingClientRect();
  return {
    viewport,
    pages: [{
      slide_index: null,
      title: "Page",
      rect: {
        w: Math.round(rootRect.width * 100) / 100,
        h: Math.round(rootRect.height * 100) / 100,
      },
      nodes: extractNodes(document, document.documentElement),
    }],
  };
}`;
