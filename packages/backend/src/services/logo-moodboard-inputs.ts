import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { LOGO_IDEA_FILES, type MoodboardMimeType } from "@bg/shared";
import type { LogoPromptPipelineState } from "../harness/prompt-logo-set";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { LogoDeliverableError, validateLogoSvg, type LogoTurnExpectation } from "./logo-deliverables";
import { LogoMoodboardError, readLogoMoodboard, readMoodboardFile } from "./logo-moodboard";
import { LOGO_IDEA_SKETCH_MAX_BYTES, readLogoDirectionsState } from "./logo-pipeline-state";

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const satisfies Record<MoodboardMimeType, string>;

/** Ideation completes ideas, not the preserved entrypoint. Screening remains the publication gate. */
export async function logoIdeationOutputComplete(stageDir: string): Promise<boolean> {
  if ((await readLogoDirectionsState(stageDir)).kind !== "present") return false;
  for (const relative of LOGO_IDEA_FILES) {
    const file = resolveWithin(stageDir, ...relative.split("/"));
    const info = await lstat(file).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    if (info === null || !info.isFile() || info.nlink !== 1 || info.size === 0 || info.size > LOGO_IDEA_SKETCH_MAX_BYTES) return false;
    try { validateLogoSvg(await readFile(file, "utf8")); }
    catch (error) { if (error instanceof LogoDeliverableError) return false; throw error; }
  }
  return true;
}

/** Hash-pinned local inputs only; names and extensions never come from uploaded filenames. */
export async function withLogoMoodboardInputs<T>(
  stageDir: string,
  expectation: LogoTurnExpectation | null,
  signal: AbortSignal,
  run: (pipeline: LogoPromptPipelineState | undefined) => Promise<T>,
): Promise<T> {
  if (expectation === null) return run(undefined);
  const files: { readonly path: string; readonly sha256: string; readonly size_bytes: number }[] = [];
  const directory = resolveWithin(stageDir, ".burnguard-inputs", "moodboard");
  const verify = async (): Promise<void> => {
    const current = await readLogoMoodboard(expectation.projectDir);
    if (current.digest !== expectation.moodboard.digest) throw new LogoDeliverableError("moodboard_changed");
    for (const file of files) {
      const target = resolveWithin(stageDir, ...file.path.split("/"));
      const info = await lstat(target).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new LogoDeliverableError("moodboard_changed");
        throw error;
      });
      if (!info.isFile() || info.nlink !== 1 || info.size !== file.size_bytes || createHash("sha256").update(await readFile(target)).digest("hex") !== file.sha256) {
        throw new LogoDeliverableError("moodboard_changed");
      }
    }
  };
  try {
    signal.throwIfAborted();
    await verify();
    if (expectation.phase === "ideate") {
      await mkdir(directory, { recursive: true });
      for (const item of expectation.moodboard.items) {
        signal.throwIfAborted();
        if (item.kind !== "file") continue;
        const content = await readMoodboardFile(expectation.projectDir, item.id);
        if (content.item.sha256 !== item.sha256 || content.item.mime_type !== item.mime_type) throw new LogoDeliverableError("moodboard_changed");
        const relative = `.burnguard-inputs/moodboard/${item.id}.${EXTENSIONS[item.mime_type]}`;
        await writeFile(resolveWithin(stageDir, ...relative.split("/")), content.bytes, { flag: "wx" });
        files.push({ path: relative, sha256: item.sha256, size_bytes: item.size_bytes });
      }
    }
    await verify();
    try {
      return await run({
        directions: expectation.priorDirections,
        adoption: expectation.adoption,
        moodboard: {
          digest: expectation.moodboard.digest,
          files,
          links: expectation.moodboard.items.flatMap((item) => item.kind === "link" ? [item.url] : []),
        },
      });
    } finally {
      signal.throwIfAborted();
      await verify();
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof LogoMoodboardError) throw new LogoDeliverableError("moodboard_changed");
    throw error;
  } finally {
    if (expectation.phase === "ideate") {
      try {
        await rm(resolveWithin(stageDir, ".burnguard-inputs", "moodboard"), { recursive: true, force: true });
      } catch (error) {
        if (error instanceof PathBoundaryError) throw new LogoDeliverableError("moodboard_changed");
        throw error;
      }
    }
  }
}
