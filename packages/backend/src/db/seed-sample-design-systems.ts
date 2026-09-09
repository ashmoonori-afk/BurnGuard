// Design-system resources have their own directory and rows; project artifact writes
// remain exclusively under ArtifactCoordinator in seed.ts and seed-tutorials.ts.
import { copyBundledFonts } from "../data/bundled-fonts";
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
  await copyBundledFonts(dirPath);
  const tokens = `@import url("./fonts/fonts.css"); :root {${Object.entries(sample.theme).map(([key, value]) => `--${key}: ${value};`).join(" ")} --font-body: "DM Sans", "Pretendard", sans-serif; --font-display: ${sample.layout === "cinematic" || sample.layout === "editorial" ? '"DM Serif Display", "Gowun Batang", serif' : '"Space Grotesk", "Pretendard", sans-serif'}; --font-mono: "IBM Plex Mono", "Pretendard", monospace; --space-section: 88px; --radius-panel: 20px; }`;
  await writeFile(path.join(dirPath, "colors_and_type.css"), tokens, "utf8");
  await writeFile(path.join(dirPath, "SKILL.md"), `# ${sample.name.replace("[burnguard:prompt-sample] ", "")}\nUse colors_and_type.css as the canonical palette. Preserve the ${sample.layout} composition, responsive grids, generous section spacing and local fonts. Body 16–18px/1.6, headings 32–64px/1.15 (Korean 1.3), supporting copy 14px/1.5 minimum. Use display/body/mono tokens, Korean fallbacks, readable contrast and wrapping at 200% zoom. Copy fonts/ with licenses and link fonts/fonts.css; no CDN. ${sample.layout === "dashboard" ? "Keep the operational dashboard layout." : "Build at least six complete vertical sections: hero, features, workflow, use case, plans, and FAQ. Every section needs substantive product-specific copy."}\n${sample.prompt}`, "utf8");
  await writeFile(path.join(dirPath, "README.md"), `# ${sample.name.replace("[burnguard:prompt-sample] ", "")}\nPublished matching design system for the ${sample.slug} example. Palette: ${Object.entries(sample.theme).map(([key, value]) => `${key}: ${value}`).join(", ")}. Preview: preview.html. Typography: display/body/mono tokens include Korean fallbacks. Body 16–18px/1.6, headings 32–64px/1.15 (Korean 1.3); preserve readable contrast and 200% zoom. Copy fonts/ with licenses and link fonts/fonts.css; no CDN. All prices and scenarios are illustrative.`, "utf8");
  await writeFile(path.join(dirPath, "preview.html"), html, "utf8");
  await db.insert(designSystemsTable).values({ id, name: `${sample.name.replace("[burnguard:prompt-sample] ", "")} Design System`, description: `Matching ${sample.layout} sample design system`, status: "published", sourceType: "sample", sourceUri: null, isTemplate: true, dirPath, skillMdPath: path.join(dirPath, "SKILL.md"), tokensCssPath: path.join(dirPath, "colors_and_type.css"), readmeMdPath: path.join(dirPath, "README.md"), thumbnailPath: null, createdAt: Date.now(), updatedAt: Date.now(), archivedAt: null }).onConflictDoNothing();
}

export async function seedSplashDesignSystemFiles(dirPath: string, html: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
  await copyBundledFonts(dirPath);
  const files = { "colors_and_type.css": '@import url("./fonts/fonts.css");\n' + (html.match(/:root \{([\s\S]*?)\}/)?.[0] ?? "") + '\n:root { --font-body: "DM Sans", "Pretendard", sans-serif; --font-display: "Space Grotesk", "Pretendard", sans-serif; --font-mono: "IBM Plex Mono", "Pretendard", monospace; }', "SKILL.md": "# Splash Design System\nUse the canonical blue, ink and pale background tokens in colors_and_type.css. Preserve rounded panels, pill actions, the transfer preview, and six vertical sections: hero, features, workflow, transparency, FAQ, final action. Use local DM Sans/Pretendard body, Space Grotesk/Pretendard headings and IBM Plex Mono numeric text. Copy fonts/ including licenses and link fonts/fonts.css; no CDN. Body 16–18px/1.6, headings 32–64px/1.15 (Korean 1.3), supporting text at least 14px/1.5. Keep contrast readable and text unclipped at 200% zoom; use responsive single-column layouts on mobile.", "README.md": "# Splash Design System\nPublished style system for the Splash landing template. Open preview.html for the complete six-section reference. Use local DM Sans/Pretendard body, Space Grotesk/Pretendard display and IBM Plex Mono numeric fonts. Copy fonts/ and licenses, link fonts/fonts.css, no CDN. Body 16–18px/1.6; headings 32–64px/1.15 (Korean 1.3). Preserve contrast and wrapping at 200% zoom. This is an illustrative product, not a payment service.", "preview.html": html };
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(dirPath, name), bytes, { encoding: "utf8", flag: "wx" }).catch((error: unknown) => { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; });
}
