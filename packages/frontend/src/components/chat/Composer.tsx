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
      return "메시지와 첨부 자료를 보내고 있어요…";
    case "cancelled":
      return "전송 요청을 취소했어요. 다시 보낼 수 있어요.";
    case "failed":
      if (state.code === "unsupported_file_kind") return "지원하지 않는 형식이라 저장하지 않았어요. 해당 파일을 빼고 다시 보내 주세요.";
      if (state.code === "unsupported_visual_source") return "URL·웹·스톡 소스는 지원하지 않아 저장하지 않았어요. 로컬 PDF 또는 PPTX를 업로드해 주세요.";
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
        <label htmlFor={`composer-${sessionId}`} className="text-xs font-semibold text-foreground">작업 요청</label>
        <span className="text-[11px] text-muted-foreground">Ctrl / ⌘ + Enter</span>
      </div>
      {activePageLabel !== null ? <div className="mb-2 w-fit max-w-full truncate rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground" title={activePageLabel}>{activePageLabel}</div> : null}
      <ComposerAttachments
        items={visualSources.items}
        sending={sending}
        onRoleChange={visualSources.setRole}
        onRemove={visualSources.remove}
      />
      {!draft.ready && <p role="status" className="text-xs text-muted-foreground">작성 중이던 내용을 불러오고 있어요…</p>}
      {draft.ready && documents.status !== "empty" && <p role="status" className="mb-2 text-xs text-muted-foreground">
        {documents.status === "saving" ? "원본을 프로젝트 docs/attachments에 저장하고 있어요…" : documents.status === "saved" ? "원본을 docs/attachments에 저장했어요. 첨부를 빼도 저장된 파일은 남아요." : "원본을 저장하지 못했어요. 다시 저장한 뒤 전송해 주세요."}
        {documents.status === "error" && <Button type="button" size="sm" variant="ghost" onClick={documents.retry}>다시 저장</Button>}
      </p>}
      {draft.storageError && <p role="status" className="text-xs text-warning-foreground">이 브라우저에서 초안을 저장하지 못했어요. 페이지를 닫기 전에 메시지를 보내 주세요.</p>}

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
        aria-label="메시지 입력"
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
          aria-label="자료 파일 선택 (PDF, PPTX)"
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
          title="설정 열기"
          aria-label="설정 열기"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 px-2.5 text-xs max-[900px]:h-11"
          title="참고할 파일을 첨부합니다"
          disabled={disabled || sending || !draft.ready}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip className="h-3.5 w-3.5" /> 자료 첨부
        </Button>
        <div className="flex-1" />
        {sending ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 px-3 text-xs max-[900px]:h-11"
            onClick={() => sendAbort.current?.abort()}
            aria-label="전송 취소"
            title="전송 요청을 취소합니다"
          >
            <StopCircle className="h-3.5 w-3.5" aria-hidden="true" /> 전송 취소
          </Button>
        ) : disabled && canInterrupt ? (
          <Button
            variant="destructive"
            size="sm"
            className="h-9 gap-1.5 px-3 text-xs max-[900px]:h-11"
            disabled={interruptPending || !onInterrupt}
            onClick={() => onInterrupt?.()}
            title="진행 중인 작업을 중단합니다"
          >
            <StopCircle className="h-3.5 w-3.5" />
            {interruptPending
              ? "중단하는 중..."
              : turnElapsedMs == null
                ? "중단"
                : `중단 · ${formatElapsed(turnElapsedMs)}`}
          </Button>
        ) : (
          <Button
            variant="cta"
            size="sm"
            className="h-9 gap-1.5 px-3 text-xs max-[900px]:h-11"
            disabled={!canSend}
            onClick={() => void send()}
            aria-label={retrying ? "다시 보내기 (Cmd/Ctrl+Enter)" : "보내기 (Cmd/Ctrl+Enter)"}
            title="보내기 (Cmd/Ctrl+Enter)"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />{" "}
            {retrying ? "다시 보내기" : "보내기"}
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
