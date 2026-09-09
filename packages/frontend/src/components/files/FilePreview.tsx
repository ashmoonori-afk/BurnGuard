import { useEffect, useState } from "react";
import { AlertCircle, Download, File, FileSearch, FolderOpen, Loader2, RotateCcw } from "lucide-react";
import type { FileInfo } from "@bg/shared";
import { ApiError, authorizedFetch } from "@/api/client";
import { Button } from "@/components/ui/button";
import { fileDisplayPath } from "./FileTree";

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

  if (!file || file.category === "folder") {
    const Icon = file ? FolderOpen : FileSearch;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-6">
        <div className="max-w-xs text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl border border-border bg-muted/40"><Icon aria-hidden="true" className="h-5 w-5 text-muted-foreground" /></div>
          <h3 className="text-sm font-medium">{file ? "폴더 안의 파일을 선택해 주세요." : "미리 볼 파일을 선택해 주세요."}</h3>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">코드와 이미지를 확인하거나 원본 파일을 내려받을 수 있어요.</p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="파일 미리보기" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1 basis-36">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">파일 미리보기 · 읽기 전용</p>
          <h3 title={file.rel_path} className="break-all font-mono text-xs leading-5">{fileDisplayPath(file.rel_path)}</h3>
        </div>
        <Button asChild variant="outline" className="min-h-11 shrink-0 text-xs">
          <a href={`/api/projects/${encodeURIComponent(projectId)}/fs/${file.rel_path.split("/").map(encodeURIComponent).join("/")}`} download={file.rel_path.split("/").at(-1)}><Download aria-hidden="true" />원본 다운로드</a>
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6" aria-busy={preview.kind === "loading"}>
        {preview.kind === "loading" && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />파일을 불러오고 있어요.</p>}
        {preview.kind === "error" && <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm"><div className="flex items-start gap-2"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><p className="leading-6">{preview.message}</p></div><Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)} className="mt-3 min-h-11"><RotateCcw aria-hidden="true" />다시 시도</Button></div>}
        {preview.kind === "image" && <div className="grid min-h-40 place-items-center rounded-xl border border-border bg-muted/30 p-3"><img src={preview.url} alt={file.rel_path} className="h-auto max-w-full rounded-md" onError={() => setPreview({ kind: "error", message: "이미지를 표시할 수 없어요. 파일이 손상되지 않았는지 확인해 주세요." })} /></div>}
        {preview.kind === "text" && <>
          {preview.truncated && <p role="status" className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">파일이 커서 처음 1MB만 표시해요. 전체 내용은 원본을 내려받아 확인해 주세요.</p>}
          <pre className="whitespace-pre-wrap break-all rounded-xl border border-border bg-muted/20 p-4 font-mono text-xs leading-6">{preview.text || "(빈 파일)"}</pre>
        </>}
        {preview.kind === "unsupported" && <div className="rounded-xl border border-dashed border-border p-6 text-center"><File aria-hidden="true" className="mx-auto mb-3 h-6 w-6 text-muted-foreground" /><h4 className="text-sm font-medium">원본 파일로 확인해 주세요.</h4><p className="mx-auto mt-2 max-w-sm text-xs leading-6 text-muted-foreground">이 형식이나 크기의 파일은 미리보기를 지원하지 않아요. 텍스트와 20MB 이하 이미지의 미리보기를 제공해요.</p></div>}
      </div>
    </section>
  );
}
