import { expect, test } from "bun:test";
import type { CatalogDesignSystemDetail } from "@bg/shared";
import { catalogDetailRows } from "../src/api/design-system-metadata";
import { catalogDetailValue } from "../src/views/DesignSystemView";
import { useLocaleStore } from "../src/i18n/locale";
import { t } from "../src/i18n/t";

const ARCHIVED_AT = 1758864000000;

function system(archivedAt: number | null): CatalogDesignSystemDetail {
  return {
    id: "system-id", name: "Current", description: null, status: "review", source_type: "github",
    source_uri: "https://example.test/source", dir_path: "/catalog/system-id", skill_md_path: "/catalog/system-id/SKILL.md",
    tokens_css_path: "/catalog/system-id/colors_and_type.css", readme_md_path: "/catalog/system-id/README.md", archived_at: archivedAt,
    is_template: false, thumbnail_path: null, kind: "design-system", owner: "local", lifecycle: archivedAt === null ? "active" : "archived",
    provenance: "observed", license: "verified", tags: ["brand"], metadata_revision: 8,
    content: { revision: 1, receipt_id: "receipt-id", digest: "digest" }, lineage: null,
    preview: { path: "README.md", fallback: false }, usage: [], warning: null, created_at: 1, updated_at: 2,
  };
}

function archivedRow(detail: CatalogDesignSystemDetail) {
  const row = catalogDetailRows(detail).find((entry) => entry.label === "Archived");
  if (row === undefined) throw new TypeError("expected an Archived row");
  return row;
}

test("Given an archived catalog system When the Archived detail is derived for en Then it is a formatted date, not the epoch", () => {
  const original = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: "en" });
  try {
    const detail = system(ARCHIVED_AT);
    const value = catalogDetailValue(archivedRow(detail), detail, "en");
    expect(value).toBe(new Date(ARCHIVED_AT).toLocaleString("en-US"));
    expect(value).not.toBe(String(ARCHIVED_AT));
  } finally {
    useLocaleStore.setState({ locale: original });
  }
});

test("Given a system that was never archived When the Archived detail is derived Then it is the localized no", () => {
  const detail = system(null);
  expect(catalogDetailValue(archivedRow(detail), detail, "ko")).toBe(t("system.no"));
});
