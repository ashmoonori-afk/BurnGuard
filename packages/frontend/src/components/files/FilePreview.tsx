import { useEffect, useState } from "react";
import type { FileInfo } from "@bg/shared";
import { ApiError, authorizedFetch } from "@/api/client";

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type PreviewContent =
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "image"; blob: Blob }
  | { kind: "unsupported" };

export async function loadFilePreview(
  projectId: string,
  file: FileInfo,
  signal: AbortSignal,
  fetchFile: typeof authorizedFetch = authorizedFetch,
): Promise<PreviewContent> {
  const path = file.rel_path.split("/").map(encodeURIComponent).join("/");
  const response = await fetchFile(`/api/projects/${encodeURIComponent(projectId)}/fs/${path}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new ApiError("file_preview_failed", "File preview unavailable", response.status);
  const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase();
  if (/^image\/(?:png|jpeg|gif|webp|svg\+xml|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(mime)) {
    if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      return { kind: "unsupported" };
    }
    const reader = response.body?.getReader();
    if (!reader) return { kind: "unsupported" };
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return { kind: "image", blob: new Blob(chunks, { type: mime }) };
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return { kind: "unsupported" }; }
        chunks.push(new Uint8Array(value).buffer);
      }
    } finally { reader.releaseLock(); }
  }
  const textFile = mime.startsWith("text/") || /(?:json|javascript|xml)$/.test(mime)
    || /\.(?:md|txt|html?|css|[cm]?js|jsx|tsx?|json|ya?ml|csv|xml|toml|svg)$/i.test(file.rel_path);
  if (!textFile) {
    await response.body?.cancel();
    return { kind: "unsupported" };
  }
  const reader = response.body?.getReader();
  if (!reader) return { kind: "text", text: "", truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  let remaining = MAX_TEXT_BYTES;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return { kind: "text", text: text + decoder.decode(), truncated: false };
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const bytes = value.subarray(0, remaining);
      text += decoder.decode(bytes, { stream: true });
      remaining -= bytes.length;
      if (bytes.length < value.length) {
        await reader.cancel();
        return { kind: "text", text: text + decoder.decode(), truncated: true };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type PreviewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "image"; url: string }
  | Exclude<PreviewContent, { kind: "image" }>;

export default function FilePreview({ projectId, file }: { projectId: string; file: FileInfo | null }) {
  const [preview, setPreview] = useState<PreviewState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!file || file.category === "folder") return;
    const controller = new AbortController();
    let imageUrl: string | null = null;
    setPreview({ kind: "loading" });
    void loadFilePreview(projectId, file, controller.signal).then((content) => {
      if (controller.signal.aborted) return;
      if (content.kind === "image") {
        imageUrl = URL.createObjectURL(content.blob);
        setPreview({ kind: "image", url: imageUrl });
      } else {
        setPreview(content);
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setPreview({ kind: "error", message: error instanceof ApiError && error.status === 404
        ? "파일을 찾을 수 없어요. 파일 목록을 새로고침해 주세요."
        : "파일을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요." });
    });
    return () => {
      controller.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [projectId, file?.rel_path, file?.hash, file?.updated_at, file?.size_bytes, file?.category, retry]);

  if (!file) return <div className="flex-1 grid place-items-center p-8 text-sm text-muted-foreground">미리 볼 파일을 선택해 주세요.</div>;
  if (file.category === "folder") return <div className="flex-1 grid place-items-center p-8 text-sm text-muted-foreground">폴더 안의 파일을 선택해 주세요.</div>;

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <header className="px-4 py-2 border-b border-border shrink-0">
        <div className="text-sm font-mono break-all">{file.rel_path}</div>
        <a className="text-xs text-accent underline" href={`/api/projects/${encodeURIComponent(projectId)}/fs/${file.rel_path.split("/").map(encodeURIComponent).join("/")}`} download={file.rel_path.split("/").at(-1)}>원본 다운로드</a>
      </header>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {preview.kind === "loading" && <p role="status" className="text-sm text-muted-foreground">파일을 불러오고 있어요.</p>}
        {preview.kind === "error" && <div role="alert" className="text-sm"><p>{preview.message}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-2 underline">다시 시도</button></div>}
        {preview.kind === "image" && <img src={preview.url} alt={file.rel_path} className="max-w-full h-auto" onError={() => setPreview({ kind: "error", message: "이미지를 표시할 수 없어요. 파일이 손상되지 않았는지 확인해 주세요." })} />}
        {preview.kind === "text" && <>
          {preview.truncated && <p role="status" className="mb-3 text-xs text-muted-foreground">파일이 커서 처음 1MB만 표시해요.</p>}
          <pre className="text-xs font-mono whitespace-pre-wrap break-words">{preview.text || "(빈 파일)"}</pre>
        </>}
        {preview.kind === "unsupported" && <p className="text-sm text-muted-foreground">이 형식이나 크기의 파일은 미리보기를 지원하지 않아요. 텍스트와 20MB 이하 이미지를 선택해 주세요.</p>}
      </div>
    </div>
  );
}
