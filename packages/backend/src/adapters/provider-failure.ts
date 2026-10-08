import type { TurnErrorCode } from "@bg/shared";

export type ProviderFailureCode = Extract<
  TurnErrorCode,
  "provider_auth_required" | "provider_usage_limited" | "provider_quota_exhausted" | "provider_model_unavailable"
>;

/** Only the head of a provider message is inspected; the classes below always name themselves early. */
const MAX_INSPECTED_CHARS = 2_000;

/**
 * A bounded allowlist, checked in order: a quota or credit message often also says "limit", and
 * an expired login must not be read as a usage window. Only the matched class leaves this module.
 */
const PROVIDER_FAILURE_PATTERNS: ReadonlyArray<readonly [ProviderFailureCode, RegExp]> = [
  ["provider_auth_required", /invalid api key|\brun \/login\b|not logged in|log(?:ged)? out and sign in/i],
  ["provider_quota_exhausted", /credit balance|insufficient_quota|exceeded your current quota/i],
  ["provider_usage_limited", /usage limit|rate[ _-]?limit|too many requests|\b(?:status|http|error):?\s+429\b/i],
  ["provider_model_unavailable", /model\b[^\n]{0,80}(?:not found|does not exist|may not exist|not available)|(?:not found|does not exist)[^\n]{0,40}\bmodel\b/i],
];

/**
 * The failure class of a provider's terminal error text, or undefined when it is not a known one.
 * The text itself is never returned, stored or logged: it can carry keys, accounts and paths.
 */
export function classifyProviderFailure(text: unknown): ProviderFailureCode | undefined {
  if (typeof text !== "string" || text.length === 0) return undefined;
  const head = text.slice(0, MAX_INSPECTED_CHARS);
  return PROVIDER_FAILURE_PATTERNS.find(([, pattern]) => pattern.test(head))?.[0];
}
