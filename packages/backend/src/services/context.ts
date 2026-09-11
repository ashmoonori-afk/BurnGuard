import { listSessionAttachments } from "../db/attachments";
import { listProjectComments } from "../db/comments";
import { getSessionProject } from "../db/events";
import { getDesignSystemDetail } from "../db/seed";
import { indexProjectFiles, listIndexedProjectFiles } from "./files";
import { getLatestDirectionState } from "./design-direction-state";
import { getSqlite } from "../db/sqlite-client";
import { readConversationHistory } from "../db/conversation-history";
import { ATTACHMENT_LIMITS } from "./attachments";
import { readImportContext } from "./project-import-init";

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
  };
}

