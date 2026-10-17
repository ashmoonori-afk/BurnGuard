import { parseEditScope, type EditScope } from "@bg/shared";

/** The entire scope is enforced at publication; prompt context stays under 4 KiB. */
export function editScopePromptLine(value?: EditScope): string {
  const scope = parseEditScope(value);
  const targets = scope.targets?.slice(0, 4) ?? [];
  for (;;) {
    const line = `<burnguard-edit-scope-v1>${JSON.stringify({ mode: scope.mode, targets, omitted_targets: (scope.targets?.length ?? 0) - targets.length }).replace(/</gu, "\\u003c")}</burnguard-edit-scope-v1>`;
    if (new TextEncoder().encode(line).byteLength < 4096) return line;
    targets.pop();
  }
}
