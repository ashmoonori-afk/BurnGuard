import type { MeasuredViewportLayout } from "@bg/shared";

const escapeXml = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);

/**
 * A block-box wireframe of one measured page at one viewport: container edges, section boxes with their column
 * dividers, and the hero blocks. Pure and deterministic (no clock, no random ids), inert (no script, links or
 * images) and drawn only from measured numbers, so the same measurement always yields the same bytes.
 */
export function renderMeasuredWireframe(layout: MeasuredViewportLayout): string {
  const { width } = layout.viewport;
  const height = Math.max(layout.page_height, layout.viewport.height);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif" font-size="14">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" stroke="#000000" stroke-width="1"/>`,
  ];
  const edge = layout.container;
  if (edge) {
    out.push(`<rect data-kind="container" x="${edge.left}" y="0" width="${edge.width}" height="${height}" fill="none" stroke="#7a7a7a" stroke-dasharray="6 6"/>`);
  }
  const left = edge?.left ?? 0;
  const span = edge?.width ?? width;
  for (const [index, section] of layout.sections.entries()) {
    out.push(`<rect data-kind="section" x="0" y="${section.top}" width="${width}" height="${section.height}" fill="#f4f4f4" stroke="#3c3c3c"/>`);
    out.push(`<text x="8" y="${section.top + 18}" fill="#3c3c3c">${index + 1}. ${escapeXml(section.heading)} (${section.columns} col, ${section.align})</text>`);
    for (let column = 0; column < section.columns; column += 1) {
      const gutter = layout.gutter ?? 0;
      const columnWidth = Math.max(0, Math.round((span - gutter * (section.columns - 1)) / section.columns));
      out.push(`<rect data-kind="column" x="${left + column * (columnWidth + gutter)}" y="${section.top + 24}" width="${columnWidth}" height="${Math.max(0, section.height - 32)}" fill="none" stroke="#9a9a9a" stroke-dasharray="3 3"/>`);
    }
  }
  for (const [name, box] of Object.entries(layout.blocks)) {
    out.push(`<rect data-kind="block" data-name="${name}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="#d8e6ff" fill-opacity="0.6" stroke="#1f4fbf"/>`);
    out.push(`<text x="${box.x + 6}" y="${box.y + 18}" fill="#1f4fbf">${escapeXml(name)}</text>`);
  }
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}
