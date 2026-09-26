import { useEffect, useState, type ReactNode } from "react";
import { bootstrapApiAuthority } from "@/api/client";
import { getSettings, patchSettings } from "@/api/home";
import { synchronizePortableLocale } from "@/i18n/locale";
import { t as translate, useT } from "@/i18n/t";
import { apiErrorCopy } from "@/lib/error-copy";
import { useUIStore } from "@/state/uiStore";

/**
 * Bootstrap is the outage check. The locale sync after it is a profile
 * convenience: its failure is reported and the shell opens with the cached locale.
 */
export async function runBootstrap(signal: AbortSignal, onSettingsSyncFailed: (error: unknown) => void): Promise<void> {
  await bootstrapApiAuthority(signal);
  try {
    await synchronizePortableLocale(getSettings, (locale) => patchSettings({ locale }));
  } catch (error) {
    onSettingsSyncFailed(error);
  }
}

/** Render recovery before API consumers mount, including while bootstrap is offline. */
export default function Bootstrap({ children }: { children: ReactNode }) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    void attempt;
    const controller = new AbortController();
    let active = true;
    setState("loading");
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void runBootstrap(controller.signal, (error) => {
      if (active) useUIStore.getState().pushToast({ title: translate("shell.settingsSyncFailed"), body: apiErrorCopy(error), tone: "warn" });
    }).then(
      () => { if (active) setState("ready"); },
      () => { if (active) setState("error"); },
    ).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt]);
  if (state === "ready") return children;
  return <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
    <div className="max-w-md space-y-4 text-center" role={state === "error" ? "alert" : "status"}>
      <h1 className="text-xl font-semibold">BurnGuard</h1>
      <p>{t(state === "loading" ? "shell.loading" : "shell.offline")}</p>
      {state === "error" && <button type="button" className="rounded-md bg-primary px-4 py-3 text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => setAttempt((value) => value + 1)}>{t("shell.reconnect")}</button>}
    </div>
  </main>;
}
