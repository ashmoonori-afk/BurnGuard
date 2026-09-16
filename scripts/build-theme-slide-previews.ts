import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { bundledDesignSystems } from "../packages/backend/src/data/bundled-design-systems";
import { renderDeckReferencePreview } from "../packages/backend/src/services/deck-reference-preview";

const root = path.resolve(import.meta.dir, "..", "design system themes");
await mkdir(path.join(root, "previews", "slides"), { recursive: true });
for (const theme of bundledDesignSystems) {
  const [brand, slides] = await Promise.all([
    readFile(path.join(root, theme.slug, "colors_and_type.css"), "utf8"),
    readFile(path.join(root, theme.slug, "surfaces/slides.css"), "utf8"),
  ]);
  const html = renderDeckReferencePreview(theme.slug, theme.name, brand, slides);
  if (!html) throw new Error(`Missing slide specimen: ${theme.slug}`);
  await writeFile(path.join(root, "previews", "slides", `${theme.slug}.html`),
    html.replaceAll("./media/", "../media/").replace('href="./fonts.css"', 'href="../../../assets/fonts/fonts.css"'));
}
