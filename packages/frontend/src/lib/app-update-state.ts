import type { AppUpdateStatus } from "@bg/shared";

export function appUpdateView(status: AppUpdateStatus) {
  const busy = status.state === "checking" || status.state === "downloading";
  let label: string;
  if (!status.supported) {
    label = "자동 업데이트는 설치 패키지에서 사용할 수 있습니다";
  } else {
    switch (status.state) {
      case "idle":
        label = status.checked_at !== null ? `최신 버전입니다 (${status.current_version})` : "업데이트 대기 중";
        break;
      case "checking":
        label = "업데이트 확인 중…";
        break;
      case "downloading":
        label = `업데이트 다운로드 중… ${status.progress ?? 0}%`;
        break;
      case "ready":
        label = `새 버전 ${status.available_version} 준비 완료 · 다시 시작하면 진행 중인 작업이 중단됩니다`;
        break;
      case "error":
        label = "업데이트를 확인하지 못했습니다 · 인터넷 연결 또는 배포 상태를 확인해 주세요";
        break;
      case "unsupported":
        label = "자동 업데이트는 설치 패키지에서 사용할 수 있습니다";
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
