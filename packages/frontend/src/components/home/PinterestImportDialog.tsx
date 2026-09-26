import { useState } from "react";
import { t, useT, type MessageKey } from "@/i18n/t";
import { PINTEREST_PIN_LIMIT, type CreatePinterestMoodResponse } from "@bg/shared";
import { ApiError } from "@/api/client";
import { extractPinterestMood } from "@/api/design-system";
import { apiErrorCopy } from "@/lib/error-copy";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, busyDialogProps } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** The shared bound the backend's invalid_pinterest_request enforces, so the count is refused here instead of after the upload. */
export { PINTEREST_PIN_LIMIT };

export function pinterestPinUrls(input: string): readonly string[] {
  return input.split(/\s+/).filter(Boolean);
}

export function pinterestSubmitState(input: string): { readonly count: number; readonly canSubmit: boolean; readonly reason: MessageKey | null } {
  const count = pinterestPinUrls(input).length;
  const tooMany = count > PINTEREST_PIN_LIMIT;
  return { count, canSubmit: count > 0 && !tooMany, reason: tooMany ? "home.pinterest.tooMany" : null };
}

/** Only a pin problem is pin advice; other backend codes use the shared recovery copy, and a raw fetch failure is a connection problem. */
export function pinterestErrorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return t("errors.network_error");
  if (error.code === "pinterest_unavailable" || error.code === "invalid_pinterest_request") return t("home.pinterest.error");
  return apiErrorCopy(error);
}

/** The dialog body, rendered inside the portal; every input arrives as a prop so the form can be rendered on its own. */
export function PinterestImportForm({ name, urls, pending, error, onNameChange, onUrlsChange, onSubmit, onCancel }: {
  readonly name: string;
  readonly urls: string;
  readonly pending: boolean;
  readonly error: unknown;
  readonly onNameChange: (name: string) => void;
  readonly onUrlsChange: (urls: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const state = pinterestSubmitState(urls);
  return <>
    <label className="grid gap-2 text-sm">{t("home.pinterest.name")}<input className="rounded-md border border-input bg-background p-2" maxLength={100} value={name} onChange={(event) => onNameChange(event.target.value)} disabled={pending} /></label>
    <label className="grid gap-2 text-sm">{t("home.pinterest.urls")}<textarea className="min-h-40 rounded-md border border-input bg-background p-2" value={urls} onChange={(event) => onUrlsChange(event.target.value)} disabled={pending} maxLength={2400} placeholder="https://www.pinterest.com/pin/123/" /></label>
    <p className="text-sm text-muted-foreground">{t("home.pinterest.hint")}</p>
    {state.reason !== null && <p role="status" className="text-sm text-destructive">{t(state.reason, { count: PINTEREST_PIN_LIMIT })}</p>}
    {error !== null && <p role="alert" className="text-sm text-destructive">{pinterestErrorCopy(error)}</p>}
    <DialogFooter><Button variant="ghost" disabled={pending} onClick={onCancel}>{t("home.cancel")}</Button><Button data-qa="pinterest-create" disabled={pending || !state.canSubmit} onClick={onSubmit}>{pending ? t("home.pinterest.pending") : t("home.pinterest.create")}</Button></DialogFooter>
  </>;
}

export default function PinterestImportDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (result: CreatePinterestMoodResponse) => void }) {
  const t = useT();
  const [urls, setUrls] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setError(null); setPending(true);
    try {
      const result = await extractPinterestMood({ pin_urls: [...pinterestPinUrls(urls)], ...(name.trim() ? { name: name.trim() } : {}) });
      onCreated(result); onOpenChange(false); setUrls(""); setName("");
    } catch (caught) { setError(caught); }
    finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) onOpenChange(value); }}>
    <DialogContent {...busyDialogProps(pending)}>
      <DialogHeader><DialogTitle>{t("home.pinterest.title")}</DialogTitle><DialogDescription>{t("home.pinterest.description")}</DialogDescription></DialogHeader>
      <PinterestImportForm name={name} urls={urls} pending={pending} error={error} onNameChange={setName} onUrlsChange={setUrls} onSubmit={() => void submit()} onCancel={() => onOpenChange(false)} />
    </DialogContent>
  </Dialog>;
}
