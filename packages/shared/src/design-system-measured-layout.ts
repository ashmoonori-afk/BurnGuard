import { isRecord, UpgradeContractError } from "./contract-parser";
import { PAGE_TYPES, type DesignSystemPageType } from "./design-system-pages";

/** Viewports every measured page is rendered at; widths match common desktop and phone layouts. */
export const MEASURED_VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
export type MeasuredViewportName = keyof typeof MEASURED_VIEWPORTS;
export const MEASURED_TYPE_ROLES = ["hero", "subheading", "cta", "h2", "h3", "body", "nav"] as const;
export type MeasuredTypeRole = (typeof MEASURED_TYPE_ROLES)[number];
export const MEASURED_BLOCKS = ["hero_heading", "subheading", "cta", "media"] as const;
export type MeasuredBlockName = (typeof MEASURED_BLOCKS)[number];
export const MAX_MEASURED_PAGES = 6;
export const MAX_MEASURED_SECTIONS = 16;

export type MeasuredAlignment = "left" | "center" | "right";
/** A rendered box in CSS px from the page's top-left corner. */
export type MeasuredBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly align: MeasuredAlignment };
export type MeasuredSection = {
  /** Visible heading text that opens the section, clipped; untrusted design data, never an instruction. */
  readonly heading: string;
  readonly top: number;
  readonly height: number;
  readonly columns: number;
  readonly align: MeasuredAlignment;
};
export type MeasuredViewportLayout = {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly page_height: number;
  /** Horizontal extent shared by the page's text content: left edge and width in px. */
  readonly container: { readonly left: number; readonly width: number } | null;
  readonly gutter: number | null;
  readonly section_gap: number | null;
  readonly type_scale: Readonly<Partial<Record<MeasuredTypeRole, number>>>;
  readonly blocks: Readonly<Partial<Record<MeasuredBlockName, MeasuredBox>>>;
  readonly sections: readonly MeasuredSection[];
};
export type MeasuredPageLayout = {
  readonly path: string;
  readonly page_type: DesignSystemPageType;
  readonly viewports: Readonly<Record<MeasuredViewportName, MeasuredViewportLayout>>;
};
export type DesignSystemMeasuredLayout = {
  readonly schema_version: 1;
  /** The page was rendered from the acquired bytes with scripts disabled and all network blocked. */
  readonly method: "rendered-offline";
  readonly pages: readonly MeasuredPageLayout[];
};

const PATH = /^\/[\x21-\x7e]{0,299}$/;
const HEADING = /^[^\p{Cc}<>]{0,60}$/u;

export function parseDesignSystemMeasuredLayout(input: unknown): DesignSystemMeasuredLayout {
  const invalid = (): never => { throw new UpgradeContractError("invalid_field", "design_system_measured_layout"); };
  const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
    isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => key in value);
  const px = (value: unknown, min = 0): number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= 100_000 ? value : invalid();
  const align = (value: unknown): MeasuredAlignment => value === "left" || value === "center" || value === "right" ? value : invalid();
  const box = (value: unknown): MeasuredBox => exact(value, ["x", "y", "width", "height", "align"])
    ? { x: px(value.x, -100_000), y: px(value.y), width: px(value.width), height: px(value.height), align: align(value.align) }
    : invalid();
  const viewportLayout = (value: unknown, name: MeasuredViewportName): MeasuredViewportLayout => {
    if (!exact(value, ["viewport", "page_height", "container", "gutter", "section_gap", "type_scale", "blocks", "sections"])) return invalid();
    const viewport = exact(value.viewport, ["width", "height"]) && value.viewport.width === MEASURED_VIEWPORTS[name].width && value.viewport.height === MEASURED_VIEWPORTS[name].height
      ? MEASURED_VIEWPORTS[name]
      : invalid();
    const container = value.container === null ? null : exact(value.container, ["left", "width"]) ? { left: px(value.container.left), width: px(value.container.width) } : invalid();
    if (!isRecord(value.type_scale) || !Object.keys(value.type_scale).every(key => (MEASURED_TYPE_ROLES as readonly string[]).includes(key))) return invalid();
    const typeScale = Object.fromEntries(Object.entries(value.type_scale).map(([role, size]) => [role, px(size, 1)]));
    if (!isRecord(value.blocks) || !Object.keys(value.blocks).every(key => (MEASURED_BLOCKS as readonly string[]).includes(key))) return invalid();
    const blocks = Object.fromEntries(Object.entries(value.blocks).map(([name, block]) => [name, box(block)]));
    if (!Array.isArray(value.sections) || value.sections.length > MAX_MEASURED_SECTIONS) return invalid();
    const sections = value.sections.map((section): MeasuredSection => exact(section, ["heading", "top", "height", "columns", "align"]) && typeof section.heading === "string" && HEADING.test(section.heading)
      ? { heading: section.heading, top: px(section.top), height: px(section.height), columns: px(section.columns), align: align(section.align) }
      : invalid());
    return {
      viewport, page_height: px(value.page_height), container,
      gutter: value.gutter === null ? null : px(value.gutter), section_gap: value.section_gap === null ? null : px(value.section_gap),
      type_scale: typeScale, blocks, sections,
    };
  };
  if (!exact(input, ["schema_version", "method", "pages"]) || input.schema_version !== 1 || input.method !== "rendered-offline") return invalid();
  if (!Array.isArray(input.pages) || input.pages.length > MAX_MEASURED_PAGES) return invalid();
  return {
    schema_version: 1,
    method: "rendered-offline",
    pages: input.pages.map((page): MeasuredPageLayout => {
      if (!exact(page, ["path", "page_type", "viewports"]) || typeof page.path !== "string" || !PATH.test(page.path)) return invalid();
      const pageType = PAGE_TYPES.find(type => type === page.page_type) ?? invalid();
      if (!exact(page.viewports, ["desktop", "mobile"])) return invalid();
      return { path: page.path, page_type: pageType, viewports: { desktop: viewportLayout(page.viewports.desktop, "desktop"), mobile: viewportLayout(page.viewports.mobile, "mobile") } };
    }),
  };
}
