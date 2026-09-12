import { useState } from "react";
import { useT } from "@/i18n/t";
import type { CreatePinterestMoodResponse } from "@bg/shared";
import { extractPinterestMood } from "@/api/design-system";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function PinterestImportDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (result: CreatePinterestMoodResponse) => void }) {
  const t = useT();
  const [urls, setUrls] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit() {
    setFailed(false); setPending(true);
    try {
      const result = await extractPinterestMood({ pin_urls: urls.split(/\s+/).filter(Boolean), ...(name.trim() ? { name: name.trim() } : {}) });
      onCreated(result); onOpenChange(false); setUrls(""); setName("");
    } catch { setFailed(true); }
    finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) onOpenChange(value); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("home.pinterest.title")}</DialogTitle><DialogDescription>{t("home.pinterest.description")}</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">{t("home.pinterest.name")}<input className="rounded-md border border-input bg-background p-2" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={pending} /></label>
      <label className="grid gap-2 text-sm">{t("home.pinterest.urls")}<textarea className="min-h-40 rounded-md border border-input bg-background p-2" value={urls} onChange={(event) => setUrls(event.target.value)} disabled={pending} maxLength={2400} placeholder="https://www.pinterest.com/pin/123/" /></label>
      <p className="text-sm text-muted-foreground">{t("home.pinterest.hint")}</p>
      {failed && <p role="alert" className="text-sm text-destructive">{t("home.pinterest.error")}</p>}
      <DialogFooter><Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>{t("home.cancel")}</Button><Button disabled={pending || !urls.trim()} onClick={() => void submit()}>{pending ? t("home.pinterest.pending") : t("home.pinterest.create")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
