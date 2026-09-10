import type { ExportOptions } from "@bg/shared";
import type { PlatformLintAsset, PlatformLintDocument, PlatformLintFinding } from "./platform-lint";

export type PackageEntry = { readonly path: string; readonly bytes: Uint8Array };
export type PackageRole = "layout" | "page_fragment" | "common_code" | "asset" | "guide" | "manifest";
export type PackageEntryRole = { readonly path: string; readonly role: PackageRole };

export type StagedPage = { readonly rel_path: string; readonly html: string };
export type StagedAsset = { readonly rel_path: string; readonly bytes: Uint8Array };

export type PlatformBuildInput = {
  readonly entrypoint: string;
  readonly slug: string;
  readonly options: ExportOptions;
  readonly staged: {
    readonly pages: readonly StagedPage[];
    readonly assets: readonly StagedAsset[];
    readonly notices: readonly StagedAsset[];
    /** Every canonical file the project owns, used to recognise references the rewriter cannot follow. */
    readonly tree: readonly string[];
  };
};

export type PlatformBuildResult = {
  readonly entries: readonly PackageEntry[];
  readonly roles: readonly PackageEntryRole[];
  readonly documents: readonly PlatformLintDocument[];
  readonly assets: readonly PlatformLintAsset[];
  readonly findings: readonly PlatformLintFinding[];
  readonly external_urls: readonly string[];
};

export function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function assetText(assets: readonly StagedAsset[], relPath: string): string | null {
  const asset = assets.find((item) => item.rel_path === relPath);
  return asset === undefined ? null : new TextDecoder().decode(asset.bytes);
}
