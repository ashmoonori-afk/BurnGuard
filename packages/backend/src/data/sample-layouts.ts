import { extractDesignSystemLayout } from "@bg/shared";

// These are the structures of the shipped sample templates, not interchangeable styles.
export const SAMPLE_LAYOUTS = {
  "split-saas": ["1160px", "60ch", "12", "28px", "16 / 10", "Split the hero into a five-column message and seven-column product preview. Follow with aligned feature columns, workflow, use case, plans and FAQ. Keep actions beside the message and preserve the two-part hero."],
  "liquid-orb": ["1160px", "56ch", "12", "24px", "1 / 1", "Keep a centered visual stage with the orb as the primary hero, short introductory copy above it and actions below. Follow with alternating text and media sections; do not turn the hero into a dashboard or side rail."],
  editorial: ["1180px", "64ch", "12", "32px", "4 / 3", "Use a masthead, a wide lead story, and a narrow reading column aligned with the story grid. Separate sections with rules and alternate lead stories with small captioned figures. Keep article text continuous instead of making every paragraph a card."],
  cinematic: ["1440px", "48ch", "12", "32px", "16 / 9", "Lead with a wide cinematic image stage and a compact caption and title anchored to one edge. Continue with large media chapters and short supporting copy. Keep the subject clear of text and avoid equal-sized card grids."],
  dashboard: ["1440px", "60ch", "12", "20px", "16 / 10", "Reserve a two-column navigation rail and ten-column workspace. Place summary metrics above the primary table, filters immediately above the table, and supporting activity below. Keep labels, values and column alignment consistent."],
  splash: ["1160px", "56ch", "12", "24px", "4 / 3", "Use a split hero with a five-column message and seven-column transfer preview. Align the feature, workflow, transparency, FAQ and final-action sections to the same outer grid. Keep the transfer panel as the primary functional example."],
} as const;

export function sampleLayoutFiles(key: keyof typeof SAMPLE_LAYOUTS) {
  const [max, measure, columns, gutter, hero, composition] = SAMPLE_LAYOUTS[key];
  const css = `:root { --layout-max: ${max}; --layout-measure: ${measure}; --layout-columns: ${columns}; --layout-gutter: ${gutter}; --layout-margin: clamp(20px, 5vw, 72px); --layout-section-y: clamp(56px, 8vw, 104px); --layout-bp-md: 760px; --layout-bp-lg: 1120px; --layout-hero: ${hero}; --layout-structure: ${key === "dashboard" ? "sidebar" : key === "editorial" ? "editorial" : key === "liquid-orb" || key === "cinematic" ? "centered" : "split"}; --family-ui-navigation-placement: ${key === "dashboard" ? "side" : "top"}; --family-ui-navigation-span: ${key === "dashboard" ? 2 : 0}; }`;
  const readme = `\n\n## Layout\n\nUse the ${columns}-column grid, ${max} maximum width, ${measure} reading measure and ${gutter} gutters declared in colors_and_type.css. Preserve the page margins, section spacing and hero ratio.\n\n## Composition\n\n${composition}\n\n## Responsive\n\nBelow 760px, stack message before media in one column and turn any side navigation into a compact top row. Keep tables in their own horizontal scroll region. Above 1120px, keep the full grid without stretching beyond the maximum width. For slides or graphics, preserve alignment and content order inside the fixed artboard; do not use the website breakpoint to change its dimensions.\n`;
  return { css, readme, layout: extractDesignSystemLayout(css, readme) };
}
