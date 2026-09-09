import path from "node:path";
import type { VisualSourceManifestV1 } from "@bg/shared";
import type { StageAttachmentInput } from "../services/stage-attachment-inputs";
import type { UserEvent } from "@bg/shared/events";
import type { buildSessionContext } from "../services/context";
import { parseStoredProjectOptions } from "../services/project-options";
import { buildResearchPromptContext } from "../services/research-purpose";
import { selectPromptLearning } from "../db/learning-store";
import { getSqlite } from "../db/sqlite-client";
import { DECK_SKILL_MD } from "./skills/deck-skill";
import { DIAGRAM_SKILL_MD } from "./skills/diagram-skill";
import { PROTOTYPE_SKILL_MD } from "./skills/prototype-skill";
import { appendAttachmentContext } from "./prompt-attachments";
import {
  COMPACT_DECK_SKILL_MD,
  COMPACT_PROTOTYPE_SKILL_MD,
} from "./prompt-compact-skills";
import { appendDesignBriefContext } from "./prompt-design-brief";
import { appendDesignSystemContext } from "./prompt-design-system";
import { appendReferenceLayoutContext } from "./prompt-reference-layout";
import { appendVisualSourceContext } from "./prompt-visual-sources";
import {
  summarizeDeckHtml,
  summarizePrototypeHtml,
} from "./structure-extractor";

export { MAX_SKILL_CHARS } from "./prompt-design-system";

type BuiltSessionContext = NonNullable<Awaited<ReturnType<typeof buildSessionContext>>>;
type SessionContext = Omit<BuiltSessionContext, "history"> & Partial<Pick<BuiltSessionContext, "history">>;

const MAX_FILES_LISTED = 60;

export type PromptContextMode = "compact" | "full";

export interface PromptBuildOptions {
  /** Authored output and structural reads use the owned operation stage. */
  outputDirectory?: string;
  contextMode?: PromptContextMode;
  visualSourceManifest?: VisualSourceManifestV1 | null;
  stageAttachmentInputs?: readonly StageAttachmentInput[];
}

/**
 * Builds the prompt text piped into the LLM CLI's stdin.
 * Mirrors doc/03-backend-adapters.md section 5.4 at a Phase 1 minimum: project state,
 * design system (SKILL.md + tokens CSS + README), attachments, user request.
 */
export async function buildPrompt(
  context: SessionContext,
  userEvent: Extract<UserEvent, { type: "user.message" }>,
  options: PromptBuildOptions = {},
): Promise<string> {
  const lines: string[] = [];
  const project = options.outputDirectory === undefined ? context.project : { ...context.project, project_dir: options.outputDirectory };
  const contextMode = options.contextMode ?? "full";
  const projectOptions = parseStoredProjectOptions(project.options_json);

  lines.push("# BurnGuard Design project session");
  lines.push("");

  lines.push("## Context budget");
  if (contextMode === "compact") {
    lines.push(
      "- Keep this turn token-light: use the file list and paths below as an index, then Read/Grep only the exact files or sections needed.",
    );
    lines.push(
      "- Do not paste entire large HTML, CSS, PPTX, PDF, or extracted-text files back into chat; summarize findings and edit targeted regions.",
    );
    lines.push(
      "- If the user asks to redesign or continue existing work, inspect the current entrypoint and nearby CSS first, then make focused edits.",
    );
  } else {
    lines.push(
      "- Full context mode is enabled, so stable project instructions and design-system excerpts are inlined below.",
    );
  }
  lines.push("");
  lines.push(
    "You are working inside a local project directory. Every file you Write or Edit will be rendered live in a canvas iframe in the BurnGuard Design app. Use the pre-installed toolset (Read/Write/Edit/Glob/Grep/Bash) to create the artifact.",
  );
  lines.push("");

  lines.push("## Project");
  lines.push(`- id: ${project.project_id}`);
  lines.push(`- name: ${project.project_name}`);
  lines.push(`- type: ${project.project_type}`);
  lines.push(`- entrypoint: ${project.entrypoint}`);
  lines.push(`- directory: ${project.project_dir}`);
  const learning = selectPromptLearning(getSqlite(), project.project_id);
  if (learning.context !== null) {
    lines.push("<burnguard-learning-context-v1>");
    lines.push(JSON.stringify(learning.context));
    lines.push("</burnguard-learning-context-v1>");
  } else if (learning.warning !== null) {
    lines.push(`<burnguard-learning-warning code="${learning.warning}" />`);
  }
  if (project.project_type === "slide_deck") {
    lines.push(
      `- use_speaker_notes: ${projectOptions.use_speaker_notes ? "true" : "false"}`,
    );
  }
  if (project.project_type === "graphic" && projectOptions.graphic_canvas !== null) {
    const canvas = projectOptions.graphic_canvas;
    lines.push("<burnguard-graphic-output-v1>");
    lines.push(JSON.stringify({
      schema_version: 1,
      width_css_px: canvas.width,
      height_css_px: canvas.height,
      artboard_count: 1,
      delivery_format: "png",
    }));
    lines.push("</burnguard-graphic-output-v1>");
    lines.push(`- Exact canvas: ${canvas.width} × ${canvas.height} CSS px.`);
    lines.push("- Author exactly one finite artboard; do not add slides, deck runtime, or a second artboard.");
    lines.push("- Replace the starter in index.html with the authored fixed-size artboard so the canvas can render the result. Keep exactly one [data-graphic-artboard] element.");
    lines.push("- PNG is the export format, not a replacement for index.html. If generating a raster image, save it inside the output directory and reference it from the authored index.html.");
    lines.push("- Do not leave the starter message or a separate unreferenced PNG as the result. BurnGuard publishes the staged files after the turn finishes.");
  }
  lines.push("");

  lines.push("## Editable 3D scenes (only when requested)");
  lines.push('For basic editable Three.js scenes, author exactly one <section data-bg-three="1" style="width:100%;height:400px"><script type="application/json" data-bg-three-config>JSON</script></section> inside the HTML. BurnGuard provisions the offline bundled runtime and MIT license after a successful turn; never use CDN imports.');
  lines.push('Scene JSON contract: {"schema_version":1,"background":"#eef2f6","objects":[{"id":"cube1","shape":"cube","color":"#3366ff","position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]}]}. At most 16 unique IDs (ASCII letters/digits/_/-, max40); shapes cube/sphere/torus; six-digit hex colors; finite position [-50,50], rotation degrees [-360,360], scale [0.1,10]. No extra keys. Preserve and edit existing data-bg-three config when present.');
  lines.push("");

  const directionState = context.designDirectionState;
  const selectedDirection = directionState?.selected_id === null
    ? undefined
    : directionState?.directions.find((direction) => direction.id === directionState.selected_id && direction.status === "ready");
  if (directionState !== null && selectedDirection !== undefined) {
    lines.push("## Selected design direction");
    lines.push("### Content outline");
    for (const item of directionState.content_outline.slice(0, 12)) lines.push(`- ${item.slice(0, 300)}`);
    lines.push(`- title: ${selectedDirection.title.slice(0, 200)}`);
    lines.push(`- layout: ${selectedDirection.layout_key}`);
    lines.push(`- style facts: ${selectedDirection.style_facts.slice(0, 8).map((fact) => fact.slice(0, 200)).join("; ")}`);
    lines.push("- Follow this selected direction only; do not merge details from unselected directions.");
    lines.push("");
  }

  lines.push("<burnguard-research-context-v1>");
  lines.push(JSON.stringify(buildResearchPromptContext({
    projectType: project.project_type,
    request: userEvent.text,
    hasCapturedFiles: context.files.length > 0,
  })));
  lines.push("</burnguard-research-context-v1>");
  lines.push("");
  appendDesignBriefContext(lines, projectOptions.design_brief);
  await appendVisualSourceContext(lines, {
    projectDir: context.project.project_dir,
    attachments: context.attachments,
    requestedPaths: userEvent.attachments ?? [],
    selections: userEvent.visualSources,
    prebuiltManifest: options.visualSourceManifest,
    stageInputs: options.stageAttachmentInputs,
  });
  appendReferenceLayoutContext(lines, {
    request: userEvent.text,
    attachments: context.attachments,
    requestedPaths: userEvent.attachments ?? [],
    selections: userEvent.visualSources,
    projectDir: context.project.project_dir,
    stageInputs: options.stageAttachmentInputs,
  });

  // Structural summary of the entrypoint, when it's an HTML artifact we know
  // how to parse. This is the main lever against runaway prompt-cache growth:
  // Claude can plan from the map and then issue 1-2 surgical Reads instead of
  // re-reading the full 100 KB+ file 6-8 times in a single agent loop.
  if (
    project.entrypoint.toLowerCase().endsWith(".html") &&
    (project.project_type === "slide_deck" ||
      project.project_type === "prototype")
  ) {
    const entrypointPath = path.isAbsolute(project.entrypoint)
      ? project.entrypoint
      : path.join(project.project_dir, project.entrypoint);
    const summary =
      project.project_type === "slide_deck"
        ? await summarizeDeckHtml(entrypointPath)
        : await summarizePrototypeHtml(entrypointPath);
    if (summary) {
      lines.push(
        project.project_type === "slide_deck"
          ? "## Deck structure (use this map; only Read sections you must change)"
          : "## Prototype structure (use this map; only Read sections you must change)",
      );
      lines.push(summary);
      lines.push("");
    }
  }

  if (context.files.length > 0) {
    lines.push("## Current files");
    for (const f of context.files.slice(0, MAX_FILES_LISTED)) {
      const size =
        typeof f.size_bytes === "number" && f.size_bytes != null
          ? ` (${f.size_bytes}B)`
          : "";
      lines.push(`- ${f.rel_path}${size}`);
    }
    if (context.files.length > MAX_FILES_LISTED) {
      lines.push(`- ... and ${context.files.length - MAX_FILES_LISTED} more`);
    }
    lines.push("");
  }

  if (context.designSystem) {
    await appendDesignSystemContext(lines, context.designSystem, contextMode);
  }

  if (userEvent.attachments && userEvent.attachments.length > 0) {
    await appendAttachmentContext(
      lines,
      context.attachments,
      userEvent.attachments,
      context.project.project_dir,
      options.stageAttachmentInputs,
    );
  }

  if (context.openComments.length > 0) {
    lines.push("## Open comments");
    for (const comment of context.openComments) {
      const body = comment.body.trim() || "(no note)";
      const selector = comment.node_selector || "body";
      const position = `x=${comment.x_pct.toFixed(1)}% y=${comment.y_pct.toFixed(1)}%`;
      const slideScope =
        comment.slide_index == null
          ? "file-wide"
          : `slide=${comment.slide_index + 1} (slide_index=${comment.slide_index})`;
      lines.push(
        `- [${comment.id}] ${comment.rel_path} ${slideScope} @ ${selector} (${position}) -> ${body}`,
      );
    }
    lines.push("");
  }

  if (project.project_type === "slide_deck") {
    lines.push("## Slide deck skill");
    lines.push(
      contextMode === "compact"
        ? COMPACT_DECK_SKILL_MD.trim()
        : DECK_SKILL_MD.trim(),
    );
    lines.push("");
  } else if (project.project_type === "prototype") {
    lines.push("## Prototype skill");
    lines.push(
      contextMode === "compact"
        ? COMPACT_PROTOTYPE_SKILL_MD.trim()
        : PROTOTYPE_SKILL_MD.trim(),
    );
    lines.push("");
  }

  if (isDiagramRequest(userEvent.text)) {
    lines.push("## Diagram skill");
    lines.push(DIAGRAM_SKILL_MD.trim());
    lines.push("");
  }

  lines.push("## Delivery");
  lines.push(
    `- Write or edit files inside \`${project.project_dir}\`. Do not touch anything outside this directory.`,
  );
  lines.push(
    `- The entrypoint \`${project.entrypoint}\` must be the primary artifact displayed in the canvas.`,
  );
  lines.push(
    "- Keep the design consistent with the design system above. Reference tokens from colors_and_type.css by CSS variable name when styling.",
  );
  lines.push(
    "- For summarized .pptx/.pdf attachments, plan from the inlined summary first and Read the extracted_text_path if you need slide or page wording.",
  );
  lines.push(
    "- Do not use Read, Glob, or Bash against the original binary .pptx/.pdf attachment path unless the harness explicitly gives you a text-safe derivative file.",
  );
  lines.push(
    "- When you are done with the current turn, end your reply with a one-sentence summary of what changed.",
  );
  lines.push("");

  if (context.history && context.history.length > 0) {
    lines.push("<burnguard-conversation-v1>");
    lines.push(JSON.stringify(context.history));
    lines.push("</burnguard-conversation-v1>");
    lines.push("");
  }
  lines.push("## Request");
  lines.push(userEvent.text);

  return lines.join("\n");
}

const DIAGRAM_REQUEST_PATTERN =
  /\b(?:diagram|flowchart|org(?:anization(?:al)?)? chart|process map|service topology|system topology)\b/i;

function isDiagramRequest(request: string): boolean {
  return DIAGRAM_REQUEST_PATTERN.test(request);
}
