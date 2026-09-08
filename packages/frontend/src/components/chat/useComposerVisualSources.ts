import type { Dispatch, SetStateAction } from "react";
import type { VisualSourceRole } from "@bg/shared";
import {
  planAttachmentIntake,
  readyAttachmentSources,
  setAttachmentRole,
  type IntakeItem,
} from "./attachment-intake";

export function useComposerVisualSources(onEdit: () => void, items: readonly IntakeItem[], setItems: Dispatch<SetStateAction<readonly IntakeItem[]>>) {
  return {
    items,
    add(files: readonly File[]) {
      setItems((current) => planAttachmentIntake(current, files));
      onEdit();
    },
    remove(id: string) {
      setItems((current) => current.filter((item) => item.id !== id));
      onEdit();
    },
    setRole(id: string, role: VisualSourceRole) {
      setItems((current) => setAttachmentRole(current, id, role));
      onEdit();
    },
    clear() {
      setItems([]);
    },
    ready() {
      return readyAttachmentSources(items);
    },
  };
}
