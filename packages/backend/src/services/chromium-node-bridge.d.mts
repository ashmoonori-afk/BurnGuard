export type BridgeServer = { readonly close: () => Promise<void> };
export type BridgeLaunchOptions = { readonly channel?: string };
export type BridgeLaunchOutcome = { readonly kind: "launched"; readonly server: BridgeServer } | { readonly kind: "failed" } | { readonly kind: "timeout" };
export type BridgeProbeVerdict = "usable" | "unusable" | "inconclusive";

export const PROBE_INCONCLUSIVE_EXIT_CODE: number;

export function launchWithin(launch: (options: BridgeLaunchOptions) => Promise<BridgeServer>, options: BridgeLaunchOptions, timeoutMs: number, deadline?: (ms: number) => Promise<void>): Promise<BridgeLaunchOutcome>;

export function probeChannels(input: {
  readonly launch: (options: BridgeLaunchOptions) => Promise<BridgeServer>;
  readonly timeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly deadline?: (ms: number) => Promise<void>;
  readonly report?: (channel: string, kind: BridgeLaunchOutcome["kind"]) => void;
}): Promise<BridgeProbeVerdict>;
