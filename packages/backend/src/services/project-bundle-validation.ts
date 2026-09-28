import { createHash } from "node:crypto";
import type { ProjectBundleManifest } from "@bg/shared";
import { isAgentControlPath } from "../security/agent-control-files";
import { PathBoundaryError, assertSafeName } from "../security/path-boundary";
import { ProjectBundleError } from "./project-bundle-error";
import { isProjectBundleCredentialPath, isProjectBundleProtectedPath } from "./project-bundle-path-policy";

export function validateProjectBundleMetadata(manifest: ProjectBundleManifest): void {
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  if (manifest.project.current_revision < 1) invalid();
  for (const file of manifest.files) {
    const designSystemFile = file.path.startsWith("design-system/");
    if ((file.kind === "design_system") !== designSystemFile || isProjectBundleCredentialPath(file.path)) invalid();
    if (!designSystemFile && !file.path.startsWith("project/")) invalid();
    const relative = file.path.slice(designSystemFile ? "design-system/".length : "project/".length);
    try { relative.split("/").forEach(assertSafeName); }
    catch (error) {
      if (error instanceof PathBoundaryError) invalid();
      throw error;
    }
    if (isProjectBundleProtectedPath(relative) || isAgentControlPath(relative)) invalid();
    if (designSystemFile) continue;
    const normalized = relative.toLocaleLowerCase("en-US");
    const validKindPath =
      file.kind === "project" ? !normalized.startsWith(".meta/") && !normalized.startsWith(".attachments/") && !normalized.startsWith(".burnguard-inputs/") :
      file.kind === "attachment" ? relative.startsWith(".attachments/") || relative.startsWith(".burnguard-inputs/") :
      file.kind === "checkpoint" ? relative.startsWith(".meta/checkpoints/") :
      false;
    if (!validKindPath) invalid();
  }
  if (files.get(`project/${manifest.project.entrypoint}`)?.kind !== "project") invalid();
  for (const attachment of manifest.attachments) {
    const file = files.get(attachment.path);
    if (!attachment.path.startsWith("project/.attachments/") || file?.kind !== "attachment" ||
      file.size_bytes !== attachment.size_bytes || file.sha256 !== attachment.sha256) invalid();
  }
  for (const checkpoint of manifest.checkpoints) {
    if (!checkpoint.path.startsWith("project/.meta/checkpoints/") || files.get(checkpoint.path)?.kind !== "checkpoint") invalid();
  }
  for (const fontPath of manifest.fonts.files) if (!files.has(fontPath)) invalid();
  const systemFiles = manifest.files.filter((file) => file.kind === "design_system");
  if ((manifest.design_system.kind === "custom") !== (systemFiles.length > 0)) invalid();
  if (manifest.design_system.kind === "custom") {
    for (const relative of [manifest.design_system.skill_md_path, manifest.design_system.tokens_css_path, manifest.design_system.readme_md_path]) {
      if (relative !== null && !files.has(`design-system/${relative}`)) invalid();
    }
  }
  const pin = manifest.design_system.pin;
  if (pin && (pin.revision < 1 || createHash("sha256").update(JSON.stringify([pin.context, pin.tokens])).digest("hex") !== pin.digest)) invalid();
}

function invalid(): never {
  throw new ProjectBundleError("invalid_project_bundle");
}
