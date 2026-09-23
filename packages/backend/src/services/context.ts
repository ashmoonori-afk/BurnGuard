import { listSessionAttachments, type AttachmentRecord } from "../db/attachments";
import type { DesignBriefV1 } from "@bg/shared";
import type { DeckSourcePage } from "./generation-output";
import { attachmentSummaryPath } from "./attachment-paths";
import { readAttachmentSummaryFile } from "./attachment-summary";
import { listProjectComments } from "../db/comments";
import { getSessionProject } from "../db/events";
import { getDesignSystemDetail } from "../db/seed";
import { indexProjectFiles, listIndexedProjectFiles } from "./files";
import { getLatestDirectionState } from "./design-direction-state";
import { getSqlite } from "../db/sqlite-client";
import { readConversationHistory } from "../db/conversation-history";
import { ATTACHMENT_LIMITS } from "./attachments";
import { readImportContext } from "./project-import-init";
import { ensureProjectDesignSystemPin } from "./project-design-system-pin";

export class DeckSourceMappingError extends Error {
  readonly code = "private_input_unavailable";
}

export async function readDeckSourcePages(
  attachments: readonly Pick<AttachmentRecord, "id" | "file_path" | "mime_type" | "source_role" | "created_at">[],
  mapping: DesignBriefV1["source_page_mapping"],
  requestedPaths: readonly string[] = [],
): Promise<readonly DeckSourcePage[] | undefined> {
  if (mapping !== "one_to_one") return undefined;
  const pages: DeckSourcePage[] = [];
  // Context relevance chooses inclusion, not source sequence. Explicit selection wins;
  // persisted sources otherwise use creation order, with ID as a stable tie-breaker.
  const ordered = [...attachments].sort((a, b) => {
    const aIndex = requestedPaths.indexOf(a.file_path);
    const bIndex = requestedPaths.indexOf(b.file_path);
    return (aIndex < 0 ? requestedPaths.length : aIndex) - (bIndex < 0 ? requestedPaths.length : bIndex)
      || a.created_at - b.created_at || a.id.localeCompare(b.id);
  });
  for (const attachment of ordered) {
    if (attachment.source_role !== "ordinary_content") continue;
    if (attachment.mime_type !== "application/pdf" && attachment.mime_type !== "application/vnd.openxmlformats-officedocument.presentationml.presentation") continue;
    const summary = await readAttachmentSummaryFile(attachmentSummaryPath(attachment.file_path));
    if (!summary || (summary.kind !== "pdf" && summary.kind !== "pptx") || summary.page_count < 1 || pages.length + summary.page_count > 80) {
      throw new DeckSourceMappingError("Source pages cannot be mapped within the deck page limit");
    }
    for (let page = 1; page <= summary.page_count; page++) pages.push({ attachmentId: attachment.id, page });
  }
  if (pages.length === 0) throw new DeckSourceMappingError("One-to-one mapping requires a paginated source document");
  return pages;
}

export function selectContextAttachments(attachments: Awaited<ReturnType<typeof listSessionAttachments>>, requestedPaths: readonly string[], request: string): string[] {
  const text = request.normalize("NFC").toLowerCase();
  const priority = (item: (typeof attachments)[number]) => requestedPaths.includes(item.file_path) ? 3 : text.includes(item.original_name.normalize("NFC").toLowerCase()) ? 2 : item.mime_type === "application/pdf" ? 1 : 0;
  const candidates = attachments.filter(item => item.turn_id !== null || requestedPaths.includes(item.file_path)).sort((a, b) => priority(b) - priority(a) || b.created_at - a.created_at || a.id.localeCompare(b.id));
  const selected: string[] = [];
  let bytes = 0;
  // ponytail: retain the intake budget; a document library selector can replace name priority if projects outgrow it.
  for (const item of candidates) {
    if (selected.length >= ATTACHMENT_LIMITS.maxCount || item.size_bytes > ATTACHMENT_LIMITS.maxBytesPerFile || bytes + item.size_bytes > ATTACHMENT_LIMITS.maxBytesTotal) continue;
    selected.push(item.file_path);
    bytes += item.size_bytes;
  }
  return selected;
}

export async function buildSessionContext(sessionId: string) {
  const project = await getSessionProject(sessionId);
  if (!project) {
    return null;
  }

  await indexProjectFiles(project.project_id);

  const [designSystem, files, attachments, comments, designDirectionState] = await Promise.all([
    project.design_system_id
      ? getDesignSystemDetail(project.design_system_id)
      : Promise.resolve(null),
    listIndexedProjectFiles(project.project_id),
    listSessionAttachments(sessionId),
    listProjectComments(project.project_id),
    getLatestDirectionState(sessionId),
  ]);

  return {
    project,
    designSystem,
    files,
    attachments,
    openComments: comments.filter((c) => c.resolved_at === null),
    designDirectionState,
    history: readConversationHistory(getSqlite(), sessionId),
    importContext: await readImportContext(project.project_dir),
    designSystemPin: await ensureProjectDesignSystemPin(project.project_id),
  };
}

