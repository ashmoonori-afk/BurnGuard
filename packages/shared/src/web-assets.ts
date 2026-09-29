/**
 * Real, licensed assets found on the web for models that cannot generate imagery. Only providers that need no
 * account key are wired: Openverse (openly licensed photos and illustrations) and Iconify (open-source icon sets).
 */
export const WEB_ASSET_KINDS = ["photo", "illustration", "icon"] as const;
export type WebAssetKind = typeof WEB_ASSET_KINDS[number];
export type WebAssetProvider = "openverse" | "iconify";

/** Project-relative directory the sourced files and their credits are written to. */
export const WEB_ASSET_DIR = "assets/web";
export const WEB_ASSET_CREDITS_FILE = "assets/web/credits.json";

/** MCP server and tool names the Claude Code adapter registers and pre-approves. */
export const WEB_ASSET_MCP_SERVER = "burnguard_assets";
export const WEB_ASSET_TOOL_NAMES = {
  search: "search_assets",
  import: "import_asset",
} as const;

export interface WebAssetCandidate {
  /** `openverse:<uuid>` or `iconify:<prefix>:<name>`; the only value import accepts. */
  readonly id: string;
  readonly kind: WebAssetKind;
  readonly provider: WebAssetProvider;
  readonly title: string;
  readonly creator: string | null;
  readonly source_url: string;
  readonly license: string;
  readonly license_url: string | null;
  readonly attribution_required: boolean;
}

export interface WebAssetCredit extends WebAssetCandidate {
  readonly file: string;
  readonly retrieved_at: string;
}

export interface WebAssetCreditsV1 {
  readonly schema_version: 1;
  readonly assets: readonly WebAssetCredit[];
}
