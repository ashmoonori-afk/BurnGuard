import type { BackendId, SequencedEventEnvelope, SessionInfo, SessionSnapshot, UserEvent, VisualSourceRole } from "@bg/shared";
import { apiFetch } from "./client";

export async function getSession(id: string): Promise<SessionInfo> {
  return apiFetch<SessionInfo>(`/api/sessions/${id}`);
}

export async function listSessionEvents(
  id: string,
  afterSequence?: number,
): Promise<SequencedEventEnvelope[]> {
  const q = afterSequence != null ? `?after_sequence=${afterSequence}` : "";
  const envelopes = await apiFetch<SequencedEventEnvelope[]>(`/api/sessions/${id}/events${q}`);
  return envelopes;
}

export async function getSessionSnapshot(id: string): Promise<SessionSnapshot> {
  return apiFetch<SessionSnapshot>(`/api/sessions/${id}/snapshot`);
}

/**
 * `signal` cancels the HTTP request only. The backend keeps its own
 * extraction lifecycle, and the client cannot observe extractor progress.
 */
export type VisualSourceUploadFile = {
  readonly id: string;
  readonly file: File;
  readonly role: VisualSourceRole;
};

export async function sendUserEvent(
  id: string,
  event: UserEvent & { files?: readonly (File | VisualSourceUploadFile)[] },
  options?: { readonly signal?: AbortSignal },
): Promise<void> {
  if (event.type === "user.message" && (event.files?.length ?? 0) > 0) {
    const form = new FormData();
    form.set("type", "user.message");
    form.set("text", event.text);
    const uploads = (event.files ?? []).map((source, index) => source instanceof File
      ? { id: `upload-${index}`, file: source, role: "ordinary_content" as const }
      : source);
    for (const upload of uploads) form.append("files", upload.file);
    form.set("visual_sources", JSON.stringify({
      schema_version: 1,
      sources: uploads.map((upload, fileIndex) => ({
        source_type: "upload",
        upload_id: upload.id,
        file_index: fileIndex,
        role: upload.role,
      })),
    }));

    await apiFetch<{ accepted: true }>(`/api/sessions/${id}/events`, {
      method: "POST",
      body: form,
      signal: options?.signal,
    });
    return;
  }

  if (event.type === "user.message") {
    await apiFetch<{ accepted: true }>(`/api/sessions/${id}/events`, {
      method: "POST",
      body: JSON.stringify({
        type: "user.message",
        text: event.text,
        attachments: event.attachments,
        visualSources: event.visualSources,
      }),
      signal: options?.signal,
    });
    return;
  }

  await apiFetch<{ accepted: true }>(`/api/sessions/${id}/events`, {
    method: "POST",
    body: JSON.stringify(event),
    signal: options?.signal,
  });
}

export async function interruptSession(id: string): Promise<void> {
  await apiFetch<{ accepted: true }>(`/api/sessions/${id}/interrupt`, {
    method: "POST",
  });
}

export async function switchSessionBackend(
  sessionId: string,
  backendId: BackendId,
): Promise<SessionInfo> {
  return apiFetch<SessionInfo>(`/api/sessions/${sessionId}/backend`, {
    method: "PATCH",
    body: JSON.stringify({ backend_id: backendId }),
  });
}

export async function submitToolDecision(
  sessionId: string,
  input: { toolCallId: string; decision: "allow" | "deny"; reason?: string },
): Promise<void> {
  await apiFetch<{ accepted: true; decision: "allow" | "deny" }>(
    `/api/sessions/${sessionId}/tool-decision`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function subscribeSessionStream(
  id: string,
  onEvent: (event: SequencedEventEnvelope) => void,
  onError?: (err: { kind: "parse" | "connection"; message: string }) => void,
  options?: { afterSequence?: number; onOpen?: () => void },
): () => void {
  const source = new EventSource(`/api/sessions/${id}/stream?after_sequence=${options?.afterSequence ?? 0}`);
  const listener = (message: MessageEvent<string>) => {
    let parsed: SequencedEventEnvelope;
    try {
      parsed = JSON.parse(message.data) as SequencedEventEnvelope;
      if (!Number.isSafeInteger(parsed?.sequence) || parsed.sequence < 1 ||
          !parsed.event || typeof parsed.event.id !== "string" || typeof parsed.event.type !== "string" || !Number.isFinite(parsed.event.ts)) {
        throw new Error("invalid_event_envelope");
      }
    } catch (err) {
      // Malformed payload — call the optional error handler so the
      // caller can surface a toast, but don't bubble up because the
      // stream is still healthy and more events may follow.
      onError?.({
        kind: "parse",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    try {
      onEvent(parsed);
    } catch (err) {
      // Likewise: an exception inside the consumer must not kill the
      // EventSource subscription.
      onError?.({
        kind: "parse",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
  // EventSource fires `error` on every connection drop, including
  // mid-flight reconnects (it auto-reconnects via the readyState ===
  // CONNECTING state). Surface the first one per disconnect cycle so
  // the UI can show a transient "reconnecting" hint without spamming.
  let lastErrorReadyState: number | null = null;
  const openListener = () => { lastErrorReadyState = null; options?.onOpen?.(); };
  const errorListener = () => {
    if (source.readyState === lastErrorReadyState) return;
    lastErrorReadyState = source.readyState;
    onError?.({
      kind: "connection",
      message:
        source.readyState === EventSource.CLOSED
          ? "Stream closed."
          : "Stream reconnecting…",
    });
  };
  source.addEventListener("message", listener as EventListener);
  source.addEventListener("error", errorListener);
  source.addEventListener("open", openListener);
  return () => {
    source.removeEventListener("message", listener as EventListener);
    source.removeEventListener("error", errorListener);
    source.removeEventListener("open", openListener);
    source.close();
  };
}
