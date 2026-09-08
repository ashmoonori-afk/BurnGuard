import { listSessionAttachments } from "../db/attachments";
import { listProjectComments } from "../db/comments";
import { getSessionProject } from "../db/events";
import { getDesignSystemDetail } from "../db/seed";
import { indexProjectFiles, listIndexedProjectFiles } from "./files";
import { getLatestDirectionState } from "./design-direction-state";
import { getSqlite } from "../db/sqlite-client";
import { readConversationHistory } from "../db/conversation-history";

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
  };
}

