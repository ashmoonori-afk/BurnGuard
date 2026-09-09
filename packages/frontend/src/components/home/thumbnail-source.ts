/**
 * Picks the image URL a card should render, or null when the deterministic
 * tint/emoji placeholder must be used instead. A URL that differs from the one
 * that previously failed is retried, so a regenerated thumbnail recovers.
 */
export function resolveThumbnailSource(
  thumbnail: string | null | undefined,
  failedSource: string | null,
): string | null {
  if (!thumbnail) return null;
  return thumbnail === failedSource ? null : thumbnail;
}

/** Cold renders continue after the HTTP deadline; retry briefly before offering manual recovery. */
export function thumbnailRetryDelay(attempt: number): number | null {
  return attempt >= 0 && attempt < 5 ? 2_000 * 2 ** attempt : null;
}
