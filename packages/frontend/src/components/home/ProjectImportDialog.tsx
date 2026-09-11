import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ProjectImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"zip" | "folder">("zip");
  const [files, setFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async () => {
      const body = new FormData(); body.set("name", name.trim()); body.set("source", source);
      for (const file of files) { body.append("files", file); if (source === "folder") body.append("paths", file.webkitRelativePath || file.name); }
      return apiFetch<{ id: string }>("/api/projects/import", { method: "POST", body });
    },
    onSuccess: async project => { await queryClient.invalidateQueries({ queryKey: ["projects"] }); onOpenChange(false); navigate(`/projects/${project.id}`); },
  });
  const oversized = files.reduce((sum, file) => sum + file.size, 0) > 48 * 1024 * 1024 || files.length > 10_000;
  const code = mutation.error instanceof ApiError ? mutation.error.code : "";
  return <Dialog open={open} onOpenChange={next => { if (!mutation.isPending) onOpenChange(next); }}>
    <DialogContent><DialogHeader><DialogTitle>프로젝트 가져오기</DialogTitle><DialogDescription>HTML·CSS·이미지와 docs 자료를 가져와 새 프로젝트로 열어요. 기존 페이지와 스타일을 읽고 자료를 추출하는 초기화가 자동으로 실행됩니다. AI 연결 없이 준비할 수 있어요.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!oversized && files.length && name.trim()) mutation.mutate(); }}>
        <label className="block space-y-2 text-sm">프로젝트 이름<Input value={name} maxLength={200} onChange={event => setName(event.target.value)} disabled={mutation.isPending} required /></label>
        <label className="block space-y-2 text-sm">가져올 형식<select className="w-full rounded-md border border-border bg-background p-2" value={source} disabled={mutation.isPending} onChange={event => { setSource(event.target.value as "zip" | "folder"); setFiles([]); mutation.reset(); }}><option value="zip">HTML ZIP 파일</option><option value="folder">HTML 프로젝트 폴더</option></select></label>
        <label className="block space-y-2 text-sm">{source === "zip" ? "ZIP 선택" : "폴더 선택"}<input key={source} type="file" className="block w-full" disabled={mutation.isPending} {...(source === "zip" ? { accept: ".zip" } : { webkitdirectory: "", directory: "", multiple: true })} onChange={event => { const next = Array.from(event.target.files ?? []); setFiles(next); mutation.reset(); if (!name && next[0]) setName((next[0].webkitRelativePath.split("/")[0] || next[0].name).replace(/\.zip$/i, "").slice(0, 200)); }} /></label>
        <p className="text-xs text-muted-foreground">최대 48MB · 압축 해제 후 128MB · 10,000개 파일. 원본 폴더는 그대로 유지해요. 대화 기록과 AI 설정은 복원하지 않아요.</p>
        <p className="text-xs text-muted-foreground">docs의 PDF·PPTX·DOCX·이미지·TXT·MD·CSV는 docs/attachments에 보존해 다음 AI 작업에 연결해요. 자료 최대 8개 · 파일당 10MB · 합계 25MB. 추출하지 못한 자료는 원본을 유지하고 대화에 알려요.</p>
        {files.length > 0 && <p role="status" className="text-xs">{files.length}개 선택됨</p>}
        {(oversized || mutation.isError) && <p role="alert" className="text-sm text-destructive">{oversized || code === "project_import_limit" || code === "payload_too_large" ? "파일 개수나 용량 제한을 초과했어요." : code === "project_import_entrypoint" ? "시작할 HTML을 찾지 못했어요. index.html 또는 내보내기 정보를 포함해 주세요." : "가져오지 못했어요. HTML 프로젝트와 지원하는 docs 자료가 포함된 ZIP 또는 폴더인지 확인해 주세요."}</p>}
        <Button className="w-full" type="submit" disabled={mutation.isPending || oversized || !files.length || !name.trim()}>{mutation.isPending ? "파일 가져오기·자료 초기화 중…" : "가져와서 열기"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
