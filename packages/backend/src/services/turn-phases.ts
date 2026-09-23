import { mkdir, readFile, lstat } from "node:fs/promises";
import { parse } from "node-html-parser";
import { ulid } from "ulid";
import type { AdapterRunInput, AdapterRunResult } from "../adapters/types";
import { resolveWithin } from "../security/path-boundary";
import { runWithContinuation } from "./turn-continuation";
import { generationOutputComplete, hasGeneratedContent, matchesDeckSourcePages, type DeckSourcePage } from "./generation-output";

export function needsGenerationPhases(projectType: string, request: string, starter = false): boolean {
  return (projectType === "slide_deck" && starter) || /대형|대규모|다중|전체.{0,12}(다시|재작성|재구성)|여러\s*(페이지|화면|장)|\b(?:large|multi-page|multi-screen|rebuild)\b|\d+\s*(?:페이지|장|pages|slides)/iu.test(request);
}

/** A server-owned loop, not a request that the model merely describe phases. */
export async function runGenerationPhases(input: AdapterRunInput, entrypoint: string, run: (input: AdapterRunInput) => Promise<AdapterRunResult>, projectType?: string, sourcePages?: readonly DeckSourcePage[]): Promise<AdapterRunResult> {
  if (sourcePages !== undefined) {
    input = {
      ...input,
      prompt: `${input.prompt}\n<deck_source_page_mapping>\n${JSON.stringify({ schema_version: 1, mode: "one_to_one", pages: sourcePages })}\n</deck_source_page_mapping>\nCreate exactly one slide per listed source page, in that order. Do not split, merge, omit or reorder pages. Each slide must carry data-bg-source-attachment matching attachmentId and data-bg-source-page matching page. Preserve the original content and conditions within each mapped page. Reference imagery and the selected design system control visual treatment, not the source-page count.`,
    };
  }
  const folder = [".burnguard-inputs", `phases-${ulid()}`];
  await mkdir(resolveWithin(input.projectDir, ...folder), { recursive: true });
  const planRelative = [...folder, "plan.json"].join("/");
  let units: string[] = [];
  let placeholders: string[] = [];
  const readOwned = async (parts: string[], maximum: number) => {
    const file = resolveWithin(input.projectDir, ...parts);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > maximum) throw new Error("phase_file_invalid");
    return readFile(file, "utf8");
  };
  const readPlan = async () => {
    const value: unknown = JSON.parse(await readOwned([...folder, "plan.json"], 32_768));
    if (!value || typeof value !== "object" || !("units" in value) || !Array.isArray(value.units) || value.units.length < 1 || value.units.length > 80 || !value.units.every((unit: unknown) => typeof unit === "string" && unit.trim().length > 0 && unit.length <= 300)) return false;
    if (sourcePages !== undefined && value.units.length !== sourcePages.length) return false;
    units = value.units;
    return true;
  };
  const savedThrough = async (end: number) => {
    const root = parse(await readOwned(entrypoint.split(/[\\/]/), 16 * 1024 * 1024));
    const nodes = root.querySelectorAll("[data-bg-unit]");
    if (projectType === "slide_deck") {
      const slides = root.querySelectorAll("[data-slide]");
      if (sourcePages !== undefined && !matchesDeckSourcePages(slides, sourcePages)) return false;
      if (slides.length !== units.length || nodes.some(node => !node.hasAttribute("data-slide") || !node.classList.contains("deck-slide") || node.parentNode?.closest("[data-slide]"))) return false;
      if (!root.querySelectorAll("script[src]").some(node => /^\/?(?:\.\/)?runtime\/deck-stage\.js(?:[?#].*)?$/.test(node.getAttribute("src") ?? ""))) return false;
    }
    return nodes.length === units.length && units.every((_unit, index) => {
      const node = nodes[index];
      if (!node || node.getAttribute("data-bg-unit") !== String(index + 1)) return false;
      if (index >= end) return true;
      if (node.getAttribute("data-bg-complete") !== "true") return false;
      return hasGeneratedContent(node) && node.innerHTML !== placeholders[index];
    });
  };
  const valid = (check: () => Promise<boolean>) => async () => {
    try { return await check(); }
    catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return false;
      throw error;
    }
  };
  const phase = async (tool: string, instruction: string, check: () => Promise<boolean>, progress: { from: number; to: number; total: number }) => {
    const toolCallId = ulid();
    await input.onEvent({ id: ulid(), ts: Date.now(), type: "tool.started", turnId: input.turnId, toolCallId, tool, input: progress });
    let ok = false;
    try {
      const result = await runWithContinuation({ ...input, prompt: `${input.prompt}\n\n<generation_phase>\n${instruction}\nFor slide decks, every unit must be a non-nested <section class="deck-slide" data-slide data-bg-unit="N">. Preserve slide geometry CSS and <script src="runtime/deck-stage.js" defer></script>. Mark unfinished content with data-bg-placeholder and remove that marker only after replacing it with actual content, never just a slide counter.\nOnly perform this phase. Save valid UTF-8 files before returning. Do not rewrite completed units or regenerate their assets. Keep changes small; never delete the entrypoint to replace it.\n</generation_phase>`, onEvent: async event => {
        // A completed phase is not a completed user request.
        if (event.type !== "status.idle" && event.type !== "chat.message_end") await input.onEvent(event);
      } }, run, valid(check));
      ok = result.exitCode === 0;
      return result;
    } finally { await input.onEvent({ id: ulid(), ts: Date.now(), type: "tool.finished", turnId: input.turnId, toolCallId, tool, ok }); }
  };
  const planned = await phase("generation_phase_plan", `Plan the requested output first. Write ${planRelative} as JSON {"units":["title and purpose", ...]} in requested order, with one unit per slide/page/artboard/section (1 to 80). Preserve the requested count. Create a small valid ${entrypoint} with one placeholder container per unit carrying data-bg-unit="1", "2", etc. For slides retain data-slide and the deck runtime. Do not generate images or write the full content yet.`, async () => await readPlan() && await savedThrough(0), { from: 0, to: 0, total: 0 });
  if (planned.exitCode !== 0) return planned;
  const scaffold = parse(await readOwned(entrypoint.split(/[\\/]/), 16 * 1024 * 1024));
  placeholders = units.map((_unit, index) => scaffold.querySelector(`[data-bg-unit="${index + 1}"]`)!.innerHTML);
  for (let start = 0; start < units.length; start += 4) {
    const end = Math.min(start + 4, units.length);
    const result = await phase("generation_phase_content", `Implement only units ${start + 1} through ${end} of ${units.length}. Their plan is ${JSON.stringify(units.slice(start, end))}. Use the shared design system. Generate only the images needed for this batch and reuse existing ones. Keep all unit containers and set data-bg-complete="true" only on completed containers. Replace the planned placeholder content, remove data-bg-placeholder and verify referenced local images exist. Save this batch to ${entrypoint}; do not implement later batches.`, async () => await savedThrough(end) && (end < units.length || await generationOutputComplete(input.projectDir, entrypoint, projectType ?? "", sourcePages?.length, sourcePages)), { from: start + 1, to: end, total: units.length });
    if (result.exitCode !== 0) return result;
  }
  await input.onEvent({ id: ulid(), ts: Date.now(), type: "chat.message_end", turnId: input.turnId });
  await input.onEvent({ id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "end_turn" });
  return { exitCode: 0 };
}
