import { useSyncExternalStore } from "react";
import { isAuthorityExpired, subscribeAuthorityState } from "@/api/client";

export function useLaunchAuthority(): boolean {
  return useSyncExternalStore(subscribeAuthorityState, isAuthorityExpired, isAuthorityExpired);
}
