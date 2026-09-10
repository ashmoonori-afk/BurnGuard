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
    <DialogContent><DialogHeader><DialogTitle>프로젝트 가져오기</DialogTitle><DialogDescription>내보낸 HTML ZIP 또는 압축을 푼 폴더를 선택하세요. HTML·CSS·이미지를 함께 복사해 새 프로젝트로 열어요. AI 연결이나 별도 승인은 필요 없어요.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!oversized && files.length && name.trim()) mutation.mutate(); }}>
        <label className="block space-y-2 text-sm">프로젝트 이름<Input value={name} maxLength={200} onChange={event => setName(event.target.value)} disabled={mutation.isPending} required /></label>
        <label className="block space-y-2 text-sm">가져올 형식<select className="w-full rounded-md border border-border bg-background p-2" value={source} disabled={mutation.isPending} onChange={event => { setSource(event.target.value as "zip" | "folder"); setFiles([]); mutation.reset(); }}><option value="zip">HTML ZIP 파일</option><option value="folder">HTML 프로젝트 폴더</option></select></label>
        <label className="block space-y-2 text-sm">{source === "zip" ? "ZIP 선택" : "폴더 선택"}<input key={source} type="file" className="block w-full" disabled={mutation.isPending} {...(source === "zip" ? { accept: ".zip" } : { webkitdirectory: "", directory: "", multiple: true })} onChange={event => { const next = Array.from(event.target.files ?? []); setFiles(next); mutation.reset(); if (!name && next[0]) setName((next[0].webkitRelativePath.split("/")[0] || next[0].name).replace(/\.zip$/i, "").slice(0, 200)); }} /></label>
        <p className="text-xs text-muted-foreground">최대 48MB · 압축 해제 후 128MB · 10,000개 파일. 원본 폴더는 그대로 유지해요. 대화 기록과 AI 설정은 복원하지 않아요.</p>
        {files.length > 0 && <p role="status" className="text-xs">{files.length}개 선택됨</p>}
        {(oversized || mutation.isError) && <p role="alert" className="text-sm text-destructive">{oversized || code === "project_import_limit" || code === "payload_too_large" ? "파일 개수나 용량 제한을 초과했어요." : code === "project_import_entrypoint" ? "시작할 HTML을 찾지 못했어요. index.html 또는 내보내기 정보를 포함해 주세요." : "가져오지 못했어요. HTML·CSS·이미지만 포함한 ZIP 또는 폴더인지 확인해 주세요."}</p>}
        <Button className="w-full" type="submit" disabled={mutation.isPending || oversized || !files.length || !name.trim()}>{mutation.isPending ? "프로젝트를 가져오고 있어요…" : "가져와서 열기"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
