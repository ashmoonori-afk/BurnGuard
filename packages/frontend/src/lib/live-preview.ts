import type { NormalizedEvent } from "@bg/shared";

type PreviewEvent = Extract<NormalizedEvent, { type: "artifact.preview" }>;

/** The newest artifact.preview in the stream, scanned backwards without copying the stream. */
export function latestArtifactPreview(events: readonly NormalizedEvent[]): PreviewEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "artifact.preview") return event;
  }
  return undefined;
}
