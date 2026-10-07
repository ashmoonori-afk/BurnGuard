import {
  MOODBOARD_LIMITS,
  MOODBOARD_MIME_TYPES,
  type MoodboardItemV1,
  type MoodboardMimeType,
} from "@bg/shared";

/**
 * Moodboard intake planning for dropped, pasted, and picked references. This
 * mirrors the backend contract for early feedback only (the backend stays
 * authoritative); it is pure, so the bounds, mime filtering, and link parsing
 * are asserted without a DOM.
 */

export type MoodboardFileRejectionReason = "invalid_file" | "limit_reached";

export type MoodboardFileRejection = {
  readonly file: File;
  readonly reason: MoodboardFileRejectionReason;
};

export type MoodboardIntakePlan = {
  readonly accepted: readonly File[];
  readonly rejected: readonly MoodboardFileRejection[];
};

export type MoodboardUsage = {
  readonly imageCount: number;
  readonly imageBytes: number;
  readonly linkCount: number;
};

const EXTENSION_MIME: Readonly<Record<string, MoodboardMimeType>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/** The accepted mime for a picked/dropped file, from its declared type or its extension. */
export function moodboardFileMime(file: File): MoodboardMimeType | null {
  const declared = MOODBOARD_MIME_TYPES.find((candidate) => candidate === file.type.toLowerCase());
  if (declared !== undefined) return declared;
  const dot = file.name.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSION_MIME[file.name.slice(dot + 1).toLowerCase()] ?? null;
}

export function moodboardUsage(items: readonly MoodboardItemV1[]): MoodboardUsage {
  let imageCount = 0;
  let imageBytes = 0;
  let linkCount = 0;
  for (const item of items) {
    if (item.kind === "file") {
      imageCount += 1;
      imageBytes += item.size_bytes;
    } else {
      linkCount += 1;
    }
  }
  return { imageCount, imageBytes, linkCount };
}

/** Splits incoming files into the ones a single upload can carry and the ones to report back. */
export function planMoodboardFileIntake(
  usage: { readonly imageCount: number; readonly imageBytes: number },
  incoming: readonly File[],
): MoodboardIntakePlan {
  const accepted: File[] = [];
  const rejected: MoodboardFileRejection[] = [];
  let imageCount = usage.imageCount;
  let imageBytes = usage.imageBytes;
  for (const file of incoming) {
    if (
      moodboardFileMime(file) === null ||
      file.size < 1 ||
      file.size > MOODBOARD_LIMITS.max_file_bytes
    ) {
      rejected.push({ file, reason: "invalid_file" });
      continue;
    }
    if (
      imageCount >= MOODBOARD_LIMITS.max_files ||
      imageBytes + file.size > MOODBOARD_LIMITS.max_total_bytes
    ) {
      rejected.push({ file, reason: "limit_reached" });
      continue;
    }
    imageCount += 1;
    imageBytes += file.size;
    accepted.push(file);
  }
  return { accepted, rejected };
}

/**
 * A public HTTPS bookmark URL, or null. This is the same shape the shared
 * board parser enforces: no credentials, no whitespace or control characters,
 * and a bounded length, so a pasted string can never become a scheme or host.
 */
export function normalizeMoodboardLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MOODBOARD_LIMITS.max_url_chars) return null;
  if (/\s/.test(trimmed) || CONTROL_CHARACTERS.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.length === 0) return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  return trimmed;
}

export type MoodboardTransferPayload = {
  readonly files: readonly File[];
  readonly uriList: string;
  readonly text: string;
};

export type MoodboardTransferPlan = {
  readonly files: readonly File[];
  readonly links: readonly string[];
};

/**
 * Classifies one drop or paste. Image files and url-bearing text are separated;
 * `text/uri-list` comment lines are dropped, and links are deduped so a paste
 * carrying both representations cannot add the same bookmark twice.
 */
export function planMoodboardTransfer(payload: MoodboardTransferPayload): MoodboardTransferPlan {
  const files = payload.files.filter((file) => moodboardFileMime(file) !== null);
  const lines = [...payload.uriList.split(/\r?\n/u), ...payload.text.split(/\r?\n/u)];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const source = line.startsWith("#") ? "" : line;
    const url = normalizeMoodboardLink(source);
    if (url !== null && !seen.has(url)) {
      seen.add(url);
      links.push(url);
    }
  }
  return { files, links };
}
