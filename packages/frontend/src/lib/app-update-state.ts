import type { AppUpdateStatus } from "@bg/shared";
import { t } from "@/i18n/t";

export function appUpdateView(status: AppUpdateStatus) {
  const busy = status.state === "checking" || status.state === "downloading";
  let label: string;
  if (!status.supported) {
    label = t("settings.updateUnsupported");
  } else {
    switch (status.state) {
      case "idle":
        label = status.checked_at !== null ? t("settings.updateCurrent", { version: status.current_version }) : t("settings.updateIdle");
        break;
      case "checking":
        label = t("settings.updateChecking");
        break;
      case "downloading":
        label = t("settings.updateDownloading", { progress: status.progress ?? 0 });
        break;
      case "ready":
        label = t("settings.updateReady", { version: status.available_version ?? "" });
        break;
      case "error":
        label = t("settings.updateFailed");
        break;
      case "unsupported":
        label = t("settings.updateUnsupported");
        break;
    }
  }
  return {
    visible: status.unsupported_reason !== "windows_shell",
    label,
    canCheck: status.supported && status.state !== "unsupported" && !busy,
    canApply: status.supported && status.state === "ready",
    busy,
  };
}
