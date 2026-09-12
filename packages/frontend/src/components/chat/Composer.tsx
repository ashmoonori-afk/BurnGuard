import { useEffect, useRef, useState } from "react";
import { defaultGenerationOptions, type BackendId, type FileInfo, type GenerationOptions } from "@bg/shared";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/api/home";
import GenerationControls from "@/components/settings/GenerationControls";
import { Paperclip, Send, Settings2, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/state/uiStore";
import { cn } from "@/lib/utils";
import { apiErrorCopy } from "@/lib/error-copy";
import { t, useT } from "@/i18n/t";
import ComposerAttachments from "./ComposerAttachments";
import { VisualSourceCandidates } from "./VisualSourceCandidates";
import {
  COMPOSER_SUPPORTED_EXTENSIONS,
  resolveSendOutcome,
  type ReadyAttachmentSource,
  type SendOutcome,
} from "./attachment-intake";
import { useComposerPlaceholder } from "./useComposerPlaceholder";
import { useComposerVisualSources } from "./useComposerVisualSources";
import { useComposerDraft } from "./useComposerDraft";
import { useComposerDocuments } from "./useComposerDocuments";

type ComposerSendState = { readonly kind: "idle" } | { readonly kind: "processing" } | SendOutcome;

function sendStateMessage(state: ComposerSendState): string | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "processing":
      return t("workspace.composer.processing");
    case "cancelled":
      return t("workspace.composer.cancelled");
    case "failed":
      if (state.code === "unsupported_file_kind") return t("workspace.composer.unsupportedFile");
      if (state.code === "unsupported_visual_source") return t("workspace.composer.unsupportedVisualSource");
      return apiErrorCopy(state);
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export default function Composer({
  sessionId,
  backendId = "claude-code",
  onSend,
  disabled = false,
  canInterrupt = false,
  turnElapsedMs = null,
  interruptPending = false,
  onInterrupt,
  initialText = "",
  activePageLabel = null,
  projectFiles = [],
}: {
  sessionId: string;
  backendId?: BackendId;
  /**
   * `signal` aborts the in-flight send request when the caller forwards it to
   * `sendUserEvent`. The composer never assumes it was honoured: it only
   * reports "cancelled" if the returned promise actually rejects with
   * AbortError.
   */
  onSend: (text: string, files: readonly ReadyAttachmentSource[], signal: AbortSignal, generation?: GenerationOptions) => void | Promise<void>;
  disabled?: boolean;
  /**
   * True when the current turn has exceeded the user's configured
   * wait threshold and the backend can accept an Interrupt POST.
   * Only surfaces the Stop button when the composer is also
   * disabled — idle composers never show Stop.
   */
  canInterrupt?: boolean;
  /** 현재 턴 경과(ms). 중단 버튼 라벨에 mm:ss로 표시한다. */
  turnElapsedMs?: number | null;
  interruptPending?: boolean;
  onInterrupt?: () => void;
  /**
   * Optional pre-fill for the textarea on first mount. Used by the
   * "Try this prompt" flow (P4.7e): the project view reads the prompt
   * out of the URL and seeds the composer so the user only has to hit
   * Send. Only the initial value matters — later changes are ignored
   * so a re-render can't clobber what the user has typed.
   */
  initialText?: string;
  activePageLabel?: string | null;
  /** Indexed managed files are disclosed as editable-only source candidates. */
  projectFiles?: readonly FileInfo[];
}) {
  const translate = useT();
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const draft = useComposerDraft(sessionId, initialText);
  const documents = useComposerDocuments(sessionId, draft.ready, draft.items);
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const generation = draft.generation ?? settings.data?.generation_defaults?.[backendId] ?? defaultGenerationOptions(backendId);
  const priorBackend = useRef(backendId);
  useEffect(() => {
    if (priorBackend.current !== backendId) {
      priorBackend.current = backendId;
      draft.setGeneration(settings.data?.generation_defaults?.[backendId] ?? defaultGenerationOptions(backendId));
    }
  }, [backendId, draft, settings.data]);
  const { text, setText } = draft;
  const appliedPrefill = useRef(initialText);
  useEffect(() => {
    if (initialText !== appliedPrefill.current) {
      appliedPrefill.current = initialText;
      setText(initialText);
    }
  }, [initialText, setText]);
  const [sendState, setSendState] = useState<ComposerSendState>({ kind: "idle" });
  const visualSources = useComposerVisualSources(() => {
    if (sendState.kind !== "processing") setSendState({ kind: "idle" });
  }, draft.items, draft.setItems);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sendAbort = useRef<AbortController | null>(null);
  const placeholder = useComposerPlaceholder(disabled);

  const sending = sendState.kind === "processing";
  const canSend = draft.ready && documents.canSend && text.trim().length > 0 && !disabled && !sending;
  const statusMessage = sendStateMessage(sendState);
  const retrying = sendState.kind === "failed" || sendState.kind === "cancelled";

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!draft.ready || disabled || sending) return;
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) {
      visualSources.add(dropped);
    }
  }

  async function send() {
    if (!canSend) return;
    const controller = new AbortController();
    sendAbort.current = controller;
    setSendState({ kind: "processing" });
    try {
      await onSend(text, visualSources.ready(), controller.signal, generation);
      draft.clear();
      setSendState({ kind: "idle" });
    } catch (error) {
      // Keep the text and the queue intact so retry costs one click.
      setSendState(resolveSendOutcome(error));
    } finally {
      sendAbort.current = null;
    }
  }

  return (
    <div
      data-qa="composer"
      className={cn(
        "max-h-[55%] shrink-0 overflow-y-auto border-t border-border bg-background p-3",
        dragOver && "ring-2 ring-accent ring-inset",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <label htmlFor={`composer-${sessionId}`} className="text-xs font-semibold text-foreground">{translate("workspace.composer.requestLabel")}</label>
        <span className="text-[11px] text-muted-foreground">Ctrl / ⌘ + Enter</span>
      </div>
      {activePageLabel !== null ? <div className="mb-2 w-fit max-w-full truncate rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground" title={activePageLabel}>{activePageLabel}</div> : null}
      <ComposerAttachments
        items={visualSources.items}
        sending={sending}
        onRoleChange={visualSources.setRole}
        onRemove={visualSources.remove}
      />
      {!draft.ready && <p role="status" className="text-xs text-muted-foreground">{translate("workspace.composer.draftLoading")}</p>}
      {draft.ready && documents.status !== "empty" && <p role="status" className="mb-2 text-xs text-muted-foreground">
        {documents.status === "saving" ? translate("workspace.composer.documentsSaving") : documents.status === "saved" ? translate("workspace.composer.documentsSaved") : translate("workspace.composer.documentsError")}
        {documents.status === "error" && <Button type="button" size="sm" variant="ghost" onClick={documents.retry}>{translate("workspace.composer.retrySave")}</Button>}
      </p>}
      {draft.storageError && <p role="status" className="text-xs text-warning-foreground">{translate("workspace.composer.draftStorageError")}</p>}

      {statusMessage !== null && (
        <p
          role="status"
          aria-live="polite"
          className="mb-2 rounded-md bg-muted px-2.5 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          {statusMessage}
        </p>
      )}

      <textarea
        id={`composer-${sessionId}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (sendState.kind !== "processing") {
            setSendState({ kind: "idle" });
          }
        }}
        placeholder={placeholder}
        rows={3}
        disabled={disabled || sending || !draft.ready}
        aria-label={translate("workspace.composer.messageInput")}
        onPaste={(e) => {
          if (!draft.ready || disabled || sending) return;
          const images = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith("image/"));
          if (images.length === 0) return;
          e.preventDefault();
          visualSources.add(images);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        className="block min-h-[88px] w-full resize-none rounded-xl border border-input bg-muted/25 p-3 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      />

      <div className="mt-2"><GenerationControls compact backendId={backendId} value={generation} onChange={draft.setGeneration} disabled={disabled || sending || !draft.ready} /></div>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={COMPOSER_SUPPORTED_EXTENSIONS.join(",")}
          aria-label={translate("workspace.composer.filePicker")}
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > 0) {
              visualSources.add(picked);
            }
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground max-[900px]:h-11 max-[900px]:w-11"
          title={translate("workspace.composer.openSettings")}
          aria-label={translate("workspace.composer.openSettings")}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 px-2.5 text-xs max-[900px]:h-11"
          title={translate("workspace.composer.attachTitle")}
          disabled={disabled || sending || !draft.ready}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip className="h-3.5 w-3.5" /> {translate("workspace.composer.attach")}
        </Button>
        <div className="flex-1" />
        {sending ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 px-3 text-xs max-[900px]:h-11"
            onClick={() => sendAbort.current?.abort()}
            aria-label={translate("workspace.composer.cancelSend")}
            title={translate("workspace.composer.cancelSendTitle")}
          >
            <StopCircle className="h-3.5 w-3.5" aria-hidden="true" /> {translate("workspace.composer.cancelSend")}
          </Button>
        ) : disabled && canInterrupt ? (
          <Button
            variant="destructive"
            size="sm"
            className="h-9 gap-1.5 px-3 text-xs max-[900px]:h-11"
            disabled={interruptPending || !onInterrupt}
            onClick={() => onInterrupt?.()}
            title={translate("workspace.composer.interruptTitle")}
          >
            <StopCircle className="h-3.5 w-3.5" />
            {interruptPending
              ? translate("workspace.composer.interrupting")
              : turnElapsedMs == null
                ? translate("workspace.composer.interrupt")
                : translate("workspace.composer.interruptElapsed", { time: formatElapsed(turnElapsedMs) })}
          </Button>
        ) : (
          <Button
            variant="cta"
            size="sm"
            className="h-9 gap-1.5 px-3 text-xs max-[900px]:h-11"
            disabled={!canSend}
            onClick={() => void send()}
            aria-label={translate(retrying ? "workspace.composer.retrySendShortcut" : "workspace.composer.sendShortcut")}
            title={translate("workspace.composer.sendShortcut")}
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />{" "}
            {translate(retrying ? "workspace.composer.retrySend" : "workspace.composer.send")}
          </Button>
        )}
      </div>
      <VisualSourceCandidates files={projectFiles} />
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
