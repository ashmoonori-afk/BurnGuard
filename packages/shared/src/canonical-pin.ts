import { isRecord, UpgradeContractError } from "./contract-parser";
import { ColorContractError } from "./color";
import { emitArtifactThemeCss, parseSemanticTheme, type SemanticTheme, type SemanticThemeMode } from "./theme";

export type CanonicalPinSelection = { readonly format: "canonical-v1"; readonly mode: SemanticThemeMode };
export type CanonicalPinContent = { readonly context: string; readonly tokens: string };
export type CanonicalPinnedTheme = { readonly schema_version: 1; readonly mode: SemanticThemeMode; readonly theme: SemanticTheme };
export type RefreshProjectDesignSystemPinRequest = {
  readonly expected_digest: string; readonly candidate_digest: string;
} & (CanonicalPinSelection | { readonly format?: never; readonly mode?: never });

const OPEN = "<selected_theme_v1>\n";
const CLOSE = "\n</selected_theme_v1>";
const SHA256 = /^[a-f0-9]{64}$/;
function invalid(): never { throw new UpgradeContractError("invalid_field", "canonical_pin"); }
function mode(value: unknown): SemanticThemeMode {
  return value === "light" || value === "dark" ? value : invalid();
}
function pinnedTheme(input: unknown): SemanticTheme {
  try { return parseSemanticTheme(input); }
  catch (error) {
    if (error instanceof ColorContractError || error instanceof SyntaxError) return invalid();
    throw error;
  }
}

export function parseCanonicalPinSelection(input: unknown): CanonicalPinSelection {
  if (!isRecord(input) || Object.keys(input).length !== 2 ||
    input.format !== "canonical-v1" || !Object.hasOwn(input, "mode")) return invalid();
  return { format: "canonical-v1", mode: mode(input.mode) };
}

export function parseRefreshProjectDesignSystemPinRequest(input: unknown): RefreshProjectDesignSystemPinRequest {
  if (!isRecord(input) || typeof input.expected_digest !== "string" || !SHA256.test(input.expected_digest) ||
    typeof input.candidate_digest !== "string" || !SHA256.test(input.candidate_digest)) return invalid();
  const selection = Object.hasOwn(input, "format")
    ? parseCanonicalPinSelection({ format: input.format, mode: input.mode }) : undefined;
  const keys = selection === undefined ? ["expected_digest", "candidate_digest"]
    : ["expected_digest", "candidate_digest", "format", "mode"];
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) return invalid();
  const identities = { expected_digest: input.expected_digest, candidate_digest: input.candidate_digest };
  return selection === undefined ? identities : { ...identities, ...selection };
}

export function canonicalPinContent(theme: SemanticTheme, selectedMode: SemanticThemeMode): CanonicalPinContent {
  const payload: CanonicalPinnedTheme = { schema_version: 1, mode: mode(selectedMode), theme: pinnedTheme(theme) };
  const context = OPEN + JSON.stringify(payload).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e") + CLOSE;
  const tokens = emitArtifactThemeCss(payload.theme);
  if (context.length > 100_000 || tokens.length > 262_144) return invalid();
  return { context, tokens };
}

/** Only an explicit canonical-v1 discriminator permits interpreting this closed machine block. */
export function parseCanonicalPinContent(content: CanonicalPinContent): CanonicalPinnedTheme {
  if (content.context.length > 100_000 || content.tokens.length > 262_144 ||
    !content.context.startsWith(OPEN) || !content.context.endsWith(CLOSE)) return invalid();
  let input: unknown;
  try { input = JSON.parse(content.context.slice(OPEN.length, -CLOSE.length)); }
  catch (error) { if (error instanceof SyntaxError) return invalid(); throw error; }
  if (!isRecord(input) || Object.keys(input).length !== 3 || input.schema_version !== 1 ||
    !Object.hasOwn(input, "mode") || !Object.hasOwn(input, "theme")) return invalid();
  const payload: CanonicalPinnedTheme = { schema_version: 1, mode: mode(input.mode), theme: pinnedTheme(input.theme) };
  const expected = canonicalPinContent(payload.theme, payload.mode);
  if (content.context !== expected.context || content.tokens !== expected.tokens) return invalid();
  return payload;
}

export function canonicalPinStylesheet(digest: string): string {
  if (!SHA256.test(digest)) return invalid();
  return `design-system/theme-${digest}.css`;
}
