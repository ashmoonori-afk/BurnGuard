import { MAX_USER_MESSAGE_CHARS } from "@bg/shared";
import type { MessageKey } from "@/i18n/t";

/** Only `session_busy` means "wait for the running turn"; every other refusal is a failed send. */
export function sendFailureTitleKey(error: unknown): MessageKey {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : null;
  return code === "session_busy" ? "workspace.project.turnBusy" : "workspace.project.sendFailed";
}

/** The counter appears once the draft reaches this share of the limit, so it stays out of the way for ordinary messages. */
const COUNTER_FRACTION = 0.9;

export type ComposerLengthState = {
  readonly canSend: boolean;
  readonly statusKey: "workspace.composer.tooLong" | null;
  readonly counter: { readonly length: number; readonly limit: number } | null;
};

/** A restored draft or prefill can exceed the cap even though the textarea itself enforces `maxLength`. */
export function composerLengthState(text: string, limit: number = MAX_USER_MESSAGE_CHARS): ComposerLengthState {
  const length = text.length;
  const tooLong = length > limit;
  return {
    canSend: !tooLong,
    statusKey: tooLong ? "workspace.composer.tooLong" : null,
    counter: length >= limit * COUNTER_FRACTION ? { length, limit } : null,
  };
}
