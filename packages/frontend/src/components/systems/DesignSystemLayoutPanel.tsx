import { designSystemLayoutPreview, missingDesignSystemLayout, type DesignSystemLayout } from "@bg/shared";
import { useT, type MessageKey } from "@/i18n/t";

const labels: Record<string, MessageKey> = {
  "--layout-max": "system.layout.max", "--layout-measure": "system.layout.measure", "--layout-columns": "system.layout.columns",
  "--layout-gutter": "system.layout.gutter", "--layout-margin": "system.layout.margin", "--layout-section-y": "system.layout.rhythm",
  "--layout-hero": "system.layout.hero", "--layout-bp-md": "system.layout.breakpoint",
};
const sections = { layout: "system.layout.title", composition: "system.layout.composition", responsive: "system.layout.responsive", family: "system.layout.family", navigation: "system.layout.navigation", hero: "system.layout.heroSection", footer: "system.layout.footer" } as const;
const regionKinds = new Set(["navigation", "hero", "footer"]);
const regionTokens: Record<string, readonly string[]> = {
  navigation: ["--layout-nav-pattern", "--layout-nav-position", "--layout-nav-height"],
  hero: ["--layout-hero-pattern", "--layout-hero-media-ratio", "--layout-hero-copy-ratio"],
  footer: ["--layout-footer-pattern", "--layout-footer-columns", "--layout-footer-height"],
};

export function DesignSystemLayoutPanel({ layout, name, loading = false, failed = false, compact = false }: { readonly layout?: DesignSystemLayout; readonly name?: string; readonly loading?: boolean; readonly failed?: boolean; readonly compact?: boolean }) {
  const t = useT();
  const missing = layout ? missingDesignSystemLayout(layout) : [];
  const preview = layout && Object.keys(layout.tokens).length ? designSystemLayoutPreview(layout) : null;
  const tokenValue = (key: string) => key === "--layout-hero" ? layout?.tokens["--layout-hero-media-ratio"] ?? layout?.tokens[key] : layout?.tokens[key];
  const renderRules = (items: DesignSystemLayout["sections"]) => items.length ? <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">{items.map(section => <div className="min-w-0" key={section.kind}><h3 className="text-sm font-semibold">{t(sections[section.kind])}</h3><p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">{section.text}</p></div>)}</div> : null;
  const regions = layout?.sections.filter(section => regionKinds.has(section.kind)) ?? [];
  const rules = renderRules(layout?.sections.filter(section => !regionKinds.has(section.kind)) ?? []);
  return <section className="my-5 min-w-0 rounded-2xl border border-border bg-card p-5 text-left" aria-label={t("system.layout.title")}>
    <h2 className="text-lg font-semibold">{t("system.layout.title")}{name ? <span className="ml-2 text-sm font-normal text-muted-foreground">{name}</span> : null}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("system.layout.help")}</p>
    {loading || failed ? <p role={failed ? "alert" : "status"} className="mt-3 text-sm">{t(failed ? "system.loadFailed" : "system.layout.loading")}</p> : !layout || missing.length ? <p role="status" className="mt-3 text-sm text-muted-foreground">{t("system.layout.incomplete")}{missing.length ? ` (${missing.map(key => key.startsWith("--") ? t(labels[key] ?? "system.layout.family") : t(sections[key as keyof typeof sections])).join(", ")})` : ""}</p> : null}
    {layout?.supplemented ? <p className="mt-3 text-xs text-muted-foreground">{t("system.layout.supplemented")}</p> : null}
    {regions.length ? <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-3">{regions.map(section => <div key={section.kind} className="min-w-0 rounded-xl bg-muted/40 p-3">
      <h3 className="text-sm font-semibold">{t(sections[section.kind])}</h3>
      <p className="mt-1 break-words text-sm text-muted-foreground">{regionTokens[section.kind]?.map(key => layout?.tokens[key]?.replaceAll("-", " ")).filter(Boolean).join(" · ")}</p>
      <details className="mt-2"><summary className="cursor-pointer text-xs font-medium">{t("system.layout.details")}</summary><p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">{section.text}</p></details>
    </div>)}</div> : null}
    {preview ? <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-2">
      <figure className="min-w-0 rounded-xl bg-muted/40 p-3">
        <svg viewBox="0 0 640 360" role="img" aria-label={t("system.layout.diagram")} className="w-full text-muted-foreground">
          {Array.from({ length: preview.columns }, (_, index) => <rect key={index} x={preview.x + index * (preview.unit + preview.gap)} y={64} width={preview.unit} height={244} fill="currentColor" opacity={0.08} />)}
          {preview.blocks.map((block, index) => <rect key={index} x={block.x} y={block.y} width={block.width} height={block.height} fill="currentColor" fillOpacity={block.role === "media" ? 0.4 : 0.18} stroke="currentColor" />)}
        </svg>
        <figcaption className="text-xs leading-5 text-muted-foreground">{t("system.layout.diagram")}</figcaption>
      </figure>
      <dl className="grid min-w-0 grid-cols-2 content-start gap-3">{Object.entries(labels).filter(([key]) => tokenValue(key)).map(([key, label]) => <div key={key} className="min-w-0 rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{t(label)}</dt><dd className="mt-1 break-words text-sm font-medium">{tokenValue(key)?.replace(/^clamp\(([^,]+),[^,]+,\s*([^)]+)\)$/, "$1 – $2")}</dd></div>)}</dl>
    </div> : null}
    {compact && rules ? <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">{t("system.layout.details")}</summary>{rules}</details> : rules}
  </section>;
}
