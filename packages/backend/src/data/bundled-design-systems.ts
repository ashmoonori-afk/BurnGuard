export const bundledDesignSystems = [
  { slug: "light", name: "Light Built-in Theme" },
  { slug: "dark", name: "Dark Built-in Theme" },
  { slug: "cupcake", name: "Cupcake Built-in Theme" },
  { slug: "retro", name: "Retro Built-in Theme" },
  { slug: "cyberpunk", name: "Cyberpunk Built-in Theme" },
  { slug: "synthwave", name: "Synthwave Built-in Theme" },
  { slug: "luxury", name: "Luxury Built-in Theme" },
  { slug: "dracula", name: "Dracula Built-in Theme" },
  { slug: "nord", name: "Nord Built-in Theme" },
  { slug: "business", name: "Business Built-in Theme" },
  // Original editorial systems authored for BurnGuard; unlike the entries above they derive from no
  // donor theme and carry no third-party license obligation.
  { slug: "cobalt-atelier", name: "Cobalt Atelier Theme" },
  { slug: "signal-reel", name: "Signal Reel Theme" },
  { slug: "daylight-press", name: "Daylight Press Theme" },
  { slug: "blueprint-manual", name: "Blueprint Manual Theme" },
  { slug: "ledger-index", name: "Ledger Index Theme" },
  { slug: "dune-editorial", name: "Dune Editorial Theme" },
  { slug: "archive-folio", name: "Archive Folio Theme" },
  // Original systems authored per design family. Each additionally ships `--family-*` tokens that
  // encode the structural decision its family turns on, plus composition and image direction in
  // `README.md`, so a theme can be reproduced from its own three files and an image generator.
  { slug: "signal-console", name: "Signal Console Theme" },
  { slug: "paper-instrument", name: "Paper Instrument Theme" },
  { slug: "quiet-runtime", name: "Quiet Runtime Theme" },
  { slug: "graphite-spec", name: "Graphite Spec Theme" },
  { slug: "long-form-press", name: "Long Form Press Theme" },
  { slug: "wide-gutter-review", name: "Wide Gutter Review Theme" },
  { slug: "quarterly-folio", name: "Quarterly Folio Theme" },
  { slug: "night-edition", name: "Night Edition Theme" },
  { slug: "studio-counter", name: "Studio Counter Theme" },
  { slug: "atelier-counter", name: "Atelier Counter Theme" },
  { slug: "market-stack", name: "Market Stack Theme" },
  { slug: "vitrine-mono", name: "Vitrine Mono Theme" },
  { slug: "night-marquee", name: "Night Marquee Theme" },
  { slug: "stencil-field", name: "Stencil Field Theme" },
  { slug: "press-riso", name: "Press Riso Theme" },
  { slug: "exhibit-wall", name: "Exhibit Wall Theme" },
  { slug: "index-table", name: "Index Table Theme" },
  { slug: "facet-archive", name: "Facet Archive Theme" },
  { slug: "console-ledger", name: "Console Ledger Theme" },
  { slug: "field-register", name: "Field Register Theme" },
  { slug: "warm-vestibule", name: "Warm Vestibule Theme" },
  { slug: "stone-court", name: "Stone Court Theme" },
  { slug: "linen-retreat", name: "Linen Retreat Theme" },
  { slug: "timber-hall", name: "Timber Hall Theme" },
] as const;

export function bundledDesignSystemId(slug: string): string {
  return `builtin-theme-${slug}`;
}
