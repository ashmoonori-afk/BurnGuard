import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TurnErrorCode } from "@bg/shared";
import { useT, type MessageKey } from "@/i18n/t";

const TURN_ERROR_MESSAGE_KEYS: Record<TurnErrorCode, MessageKey> = {
  graphic_requires_authenticated_codex: "chat.error.graphicRequiresAuthenticatedCodex",
  graphic_starter_unchanged: "chat.error.graphicStarterUnchanged",
  commandcode_unavailable: "chat.error.commandCodeUnavailable",
  unsupported_generation_model_effort: "chat.error.unsupportedModelEffort",
  backend_unavailable: "chat.error.backendUnavailable",
  path_unavailable: "chat.error.pathUnavailable",
  immutable_reference_mutated: "chat.error.immutableReferenceMutated",
  immutable_reference_path_unavailable: "chat.error.immutableReferencePathUnavailable",
  immutable_reference_escaped: "chat.error.immutableReferenceEscaped",
  private_input_unavailable: "chat.error.privateInputUnavailable",
  publication_failed: "chat.error.publicationFailed",
  operation_conflict: "chat.error.operationConflict",
  operation_cancelled: "chat.error.operationCancelled",
  turn_failed: "chat.error.turnFailed",
};

export default function ErrorCard({
  code,
  recoverable,
}: {
  message: string;
  code?: TurnErrorCode;
  recoverable: boolean;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-destructive">{t("chat.error.title")}</div>
          <div className="text-destructive/80 mt-0.5 break-words">
            {t(TURN_ERROR_MESSAGE_KEYS[code ?? "turn_failed"])}
          </div>
          {recoverable && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => document.querySelector<HTMLTextAreaElement>('[data-qa="composer"] textarea')?.focus()}>
                <RefreshCw className="h-3 w-3" /> {t("chat.error.focusComposer")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
