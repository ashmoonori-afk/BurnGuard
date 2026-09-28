import type { HandoffManifest } from "@bg/shared";

export function renderHandoffMarkdown(manifest: HandoffManifest): string {
  const lines = [
    "# Production handoff",
    "",
    `Project: ${cell(manifest.project.name)}`,
    `Entrypoint: \`source/${manifest.project.entrypoint}\``,
    "Manifest: `handoff/manifest.json`",
    "",
    "## Pages and regions",
    "",
    "| Page | Kind | Region | Component | Route | Tokens |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const page of manifest.pages) {
    if (page.regions.length === 0) {
      lines.push(
        `| ${cell(page.title)} | ${page.kind} | - | - | - | - |`,
      );
      continue;
    }
    for (const region of page.regions) {
      lines.push(
        `| ${cell(page.title)} | ${page.kind} | \`${cell(region.node_id)}\` | ${cell(region.component ?? "-")} | ${cell(region.route ?? "-")} | ${cell(region.token_refs.join(", ") || "-")} |`,
      );
    }
  }
  lines.push(
    "",
    "## Routes",
    "",
    ...manifest.routes.map((route) =>
      `- \`${route.path}\` -> \`${route.source_file}\` (${route.kind})`
    ),
    "",
    "## Interactions",
    "",
    ...manifest.interactions.map((interaction) =>
      `- ${interaction.status}: ${interaction.kind} \`${interaction.id}\`${interaction.target === null ? "" : ` -> \`${interaction.target}\``}`
    ),
    "",
    "## Responsive rules",
    "",
    ...manifest.responsive_rules.map((rule) =>
      `- \`${rule.condition}\` in \`${rule.source_file}\``
    ),
    "",
    "## Assets",
    "",
    ...manifest.assets.map((asset) =>
      `- ${asset.kind}: \`${asset.path}\``
    ),
    "",
    "## Acceptance checks",
    "",
    ...manifest.acceptance_checks.map((check) =>
      `- [ ] ${check.id} (${check.status})`
    ),
    "",
    "## Unresolved backend work",
    "",
    ...(manifest.unresolved_backend_work.length === 0
      ? ["- None detected statically."]
      : manifest.unresolved_backend_work.map((item) =>
        `- ${item.reason}: \`${item.interaction_id}\` in \`${item.source_file}\``
      )),
    "",
    "## Continue in a coding CLI",
    "",
    "Run either command from the unzipped handoff root:",
    "",
    "```sh",
    manifest.continuation.commands.claude_code,
    "```",
    "",
    "```sh",
    manifest.continuation.commands.codex,
    "```",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export function renderHandoffPrompt(manifest: HandoffManifest): string {
  return `# BurnGuard production handoff

Treat the directory containing \`HANDOFF.md\` as the unzipped bundle root.
Use \`handoff/manifest.json\` as the machine-readable authority and inspect the
artifact under \`source/\`. Preserve the pinned design-system intent, routes,
assets, responsive rules, and region identities recorded in the manifest.

Replace every interaction marked \`mocked\` with production behavior. Resolve
each item in \`unresolved_backend_work\` against the target repository's real
services and data contracts. Do not invent completed integrations.

Run every \`acceptance_checks\` entry and report what changed, what was verified,
and what remains unresolved. The preview and review files are evidence from the
handoff export, not production approval.

Project type: ${manifest.project.type}
Entrypoint: ${manifest.project.entrypoint}
`;
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
