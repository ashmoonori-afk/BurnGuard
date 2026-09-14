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
] as const;

export function bundledDesignSystemId(slug: string): string {
  return `builtin-theme-${slug}`;
}
