import type { DesignBriefV1 } from "@bg/shared";

export function appendDesignBriefContext(
  lines: string[],
  designBrief: DesignBriefV1 | null,
): void {
  if (designBrief === null) return;
  lines.push("<burnguard-design-brief-v1>");
  lines.push(JSON.stringify(designBrief));
  lines.push("</burnguard-design-brief-v1>");
  if (designBrief.output_type === "prototype" && designBrief.section_count !== undefined) lines.push(`Create exactly ${designBrief.section_count} complete vertical content sections, each with substantive copy and a purpose-built layout; navigation and footer do not count as sections.`);
  lines.push("");
}
