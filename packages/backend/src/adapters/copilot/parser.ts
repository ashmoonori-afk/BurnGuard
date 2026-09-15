import type { NormalizedEvent } from "@bg/shared";
import { normalizeStreamLine, type StreamParserContext } from "../stream-normalizer";

export type CopilotParserContext = StreamParserContext;

/**
 * GitHub Copilot CLI prints human-readable text in programmatic (`-p`) mode; it publishes no
 * structured stream format. Lines therefore become chat deltas, and any JSON the CLI starts emitting
 * later is handled by the shared normalizer without a change here.
 */
export function parseCopilotLine(line: string, ctx: CopilotParserContext): NormalizedEvent[] {
  return normalizeStreamLine(line, ctx);
}
