import type { NormalizedEvent } from "@bg/shared";
import { normalizeStreamLine, type StreamParserContext } from "../stream-normalizer";

export type GrokParserContext = StreamParserContext;

/**
 * Grok CLI headless mode prints plain text. Lines become chat deltas through the shared normalizer,
 * which also absorbs any JSON the CLI may start emitting.
 */
export function parseGrokLine(line: string, ctx: GrokParserContext): NormalizedEvent[] {
  return normalizeStreamLine(line, ctx);
}
