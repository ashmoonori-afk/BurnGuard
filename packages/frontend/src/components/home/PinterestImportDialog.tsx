import { useState } from "react";
import type { CreatePinterestMoodResponse } from "@bg/shared";
import { extractPinterestMood } from "@/api/design-system";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function PinterestImportDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (result: CreatePinterestMoodResponse) => void }) {
  const [urls, setUrls] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setError(""); setPending(true);
    try {
      const result = await extractPinterestMood({ pin_urls: urls.split(/\s+/).filter(Boolean), ...(name.trim() ? { name: name.trim() } : {}) });
      onCreated(result); onOpenChange(false); setUrls(""); setName("");
    } catch { setError("공개 핀을 읽지 못했어요. pinterest.com/pin/숫자/ 주소를 확인하거나 웹사이트·파일 가져오기를 이용해 주세요."); }
    finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) onOpenChange(value); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Pinterest에서 무드 가져오기</DialogTitle><DialogDescription>공개 핀 1~12개의 이미지 색상으로 디자인 시스템 초안을 만들어요. 글꼴과 레이아웃은 기본값이며 원본 이미지가 저장되지는 않아요. 비공개 핀과 보드 주소는 지원하지 않아요.</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">이름 (선택)<input className="rounded-md border border-input bg-background p-2" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={pending} /></label>
      <label className="grid gap-2 text-sm">핀 주소 (한 줄에 하나)<textarea className="min-h-40 rounded-md border border-input bg-background p-2" value={urls} onChange={(event) => setUrls(event.target.value)} disabled={pending} maxLength={2400} placeholder="https://www.pinterest.com/pin/123/" /></label>
      <p className="text-sm text-muted-foreground">읽을 수 있는 핀만 사용하며, 누락된 핀은 추출 결과에 표시해요.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>취소</Button><Button disabled={pending || !urls.trim()} onClick={() => void submit()}>{pending ? "이미지 색상 분석 중…" : "무드 초안 만들기"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
