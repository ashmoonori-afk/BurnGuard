// Design-system resources have their own directory and rows; project artifact writes
// remain exclusively under ArtifactCoordinator in seed.ts and seed-tutorials.ts.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { designSystemsTable } from "./schema";
import { systemsDir } from "../lib/paths";
import type { PromptSample } from "./seed-tutorials";

export function promptSampleDesignSystemId(slug: string): string { return `sample-system-${slug}`; }

export async function seedPromptSampleDesignSystem(sample: PromptSample, html: string): Promise<void> {
  const id = promptSampleDesignSystemId(sample.slug);
  const dirPath = path.join(systemsDir, id);
  const db = getDb();
  if ((await db.select({ id: designSystemsTable.id }).from(designSystemsTable).where(eq(designSystemsTable.id, id))).length) return;
  await mkdir(dirPath, { recursive: true });
  const tokens = `:root {${Object.entries(sample.theme).map(([key, value]) => `--${key}: ${value};`).join(" ")} --font-body: system-ui, sans-serif; --font-display: ${sample.layout === "cinematic" ? "Georgia, serif" : "system-ui, sans-serif"}; --space-section: 88px; --radius-panel: 20px; }`;
  await writeFile(path.join(dirPath, "colors_and_type.css"), tokens, "utf8");
  await writeFile(path.join(dirPath, "SKILL.md"), `# ${sample.name.replace("[burnguard:prompt-sample] ", "")}\nUse colors_and_type.css as the canonical palette. Preserve the ${sample.layout} composition, responsive grids, generous section spacing and local fonts. ${sample.layout === "dashboard" ? "Keep the operational dashboard layout." : "Build at least six complete vertical sections: hero, features, workflow, use case, plans, and FAQ. Every section needs substantive product-specific copy."}\n${sample.prompt}`, "utf8");
  await writeFile(path.join(dirPath, "README.md"), `# ${sample.name.replace("[burnguard:prompt-sample] ", "")}\nPublished matching design system for the ${sample.slug} example. Palette: ${Object.entries(sample.theme).map(([key, value]) => `${key}: ${value}`).join(", ")}. Preview: preview.html. All prices and scenarios are illustrative.`, "utf8");
  await writeFile(path.join(dirPath, "preview.html"), html, "utf8");
  await db.insert(designSystemsTable).values({ id, name: `${sample.name.replace("[burnguard:prompt-sample] ", "")} Design System`, description: `Matching ${sample.layout} sample design system`, status: "published", sourceType: "sample", sourceUri: null, isTemplate: true, dirPath, skillMdPath: path.join(dirPath, "SKILL.md"), tokensCssPath: path.join(dirPath, "colors_and_type.css"), readmeMdPath: path.join(dirPath, "README.md"), thumbnailPath: null, createdAt: Date.now(), updatedAt: Date.now(), archivedAt: null }).onConflictDoNothing();
}

export async function seedSplashDesignSystemFiles(dirPath: string, html: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
  const files = { "colors_and_type.css": html.match(/:root \{([\s\S]*?)\}/)?.[0] ?? "", "SKILL.md": "# Splash Design System\nUse the canonical blue, ink and pale background tokens in colors_and_type.css. Preserve rounded panels, pill actions, the transfer preview, and six vertical sections: hero, features, workflow, transparency, FAQ, final action. Use system fonts and responsive single-column layouts on mobile.", "README.md": "# Splash Design System\nPublished style system for the Splash landing template. Open preview.html for the complete six-section reference. This is an illustrative product, not a payment service.", "preview.html": html };
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(dirPath, name), bytes, { encoding: "utf8", flag: "wx" }).catch((error: unknown) => { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; });
}
