import { Resolver, lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import {
  AcquisitionLimitError,
  DEFAULT_ACQUISITION_LIMITS,
  abortable,
  throwIfAcquisitionAborted,
  type AcquisitionLimits,
} from "./extraction-acquisition";
import { DesignSystemExtractError } from "./extraction-errors";
import { isUnsafeImportHostname, normalizeImportHostname } from "./extraction-path";
import { isOwnedQaAdapterResourceUrl, qaAdapterRequestHeaders } from "./extraction-qa-adapter";

export type WebsiteFetchOptions = {
  readonly maxBytes: number;
  readonly kind: "html" | "css" | "asset";
  readonly noteBytes: (bytes: number) => void;
  readonly signal: AbortSignal;
  readonly userAgent: string;
  readonly limits?: AcquisitionLimits;
};

export async function fetchWebsiteResource(
  inputUrl: URL,
  options: WebsiteFetchOptions,
): Promise<{ readonly finalUrl: URL; readonly text: string; readonly buffer: Buffer }> {
  let current = new URL(inputUrl.toString());
  const limits = options.limits ?? DEFAULT_ACQUISITION_LIMITS;
  for (let redirectCount = 0; redirectCount <= limits.redirects; redirectCount += 1) {
    const addresses = await resolveSafeImportAddresses(current, options.signal);
    let response: Response;
    try {
      response = await requestPinnedWebsiteResource(current, addresses, options);
    } catch (error) {
      if (options.signal.aborted) throwIfAcquisitionAborted(options.signal);
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new DesignSystemExtractError("website_fetch_failed", `Redirect missing Location header for ${current.toString()}`);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new DesignSystemExtractError("website_fetch_failed", `Website fetch failed with HTTP ${response.status}`); }
    const buffer = await readResponseWithinLimit(response, options.maxBytes, options.signal, limits, options.kind);
    options.noteBytes(buffer.byteLength);
    return { finalUrl: current, text: options.kind === "asset" ? "" : buffer.toString("utf8"), buffer };
  }
  throw new AcquisitionLimitError("redirects", limits.redirects, limits.redirects + 1);
}

export function assertAssetCount(count: number, limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS): void {
  if (count > limits.assets) throw new AcquisitionLimitError("assets", limits.assets, count);
}

export function assertAggregateAssetBytes(bytes: number, limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS): void {
  if (bytes > limits.assetBytes) throw new AcquisitionLimitError("asset_bytes", limits.assetBytes, bytes);
}

async function readResponseWithinLimit(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  limits: AcquisitionLimits,
  kind: WebsiteFetchOptions["kind"],
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0; let cancellation = Promise.resolve();
  try {
    while (true) {
      throwIfAcquisitionAborted(signal);
      const { done, value } = await abortable(reader.read(), signal, () => { cancellation = reader.cancel(); });
      throwIfAcquisitionAborted(signal);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        const limit = kind === "html" ? "html_bytes" : kind === "css" ? "css_bytes" : "asset_bytes";
        throw new AcquisitionLimitError(limit, maxBytes, total);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  } finally {
    await cancellation;
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type ImportAddress = { readonly address: string; readonly family: 4 | 6 };

export async function resolveSafeImportAddresses(url: URL, signal: AbortSignal, resolver: Pick<Resolver, "resolve4" | "resolve6" | "cancel"> = new Resolver(), systemLookup: (hostname: string) => Promise<readonly { address: string; family: number }[]> = (hostname) => lookup(hostname, { all: true })): Promise<readonly ImportAddress[]> {
  throwIfAcquisitionAborted(signal);
  const ownedQaAdapter = isOwnedQaAdapterResourceUrl(url);
  if ((!ownedQaAdapter && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
    throw new DesignSystemExtractError("invalid_source_url", "Website URL must use HTTPS without credentials");
  }
  const host = normalizeImportHostname(url.hostname);
  if (isUnsafeImportHostname(host) && !ownedQaAdapter) {
    throw new DesignSystemExtractError("invalid_source_url", `Blocked private or local website host: ${url.hostname}`);
  }
  const family = isIP(host);
  if (family === 4 || family === 6) return [{ address: host, family }];
  const resolved = await abortable(Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]), signal, () => resolver.cancel());
  // OS lookup supports Windows/network configurations where direct DNS is refused.
  // An empty successful DNS answer is authoritative; fallback only if both queries failed.
  if (resolved.every((result) => result.status === "rejected")) {
    const fallback = await abortable(systemLookup(host).catch(() => []), signal);
    resolved.push({ status: "fulfilled", value: fallback.map((result) => result.address) });
  }
  const addresses: ImportAddress[] = [];
  for (const result of resolved) {
    if (result.status !== "fulfilled") continue;
    for (const address of result.value) {
      const family = isIP(address);
      if ((family !== 4 && family !== 6) || isUnsafeImportHostname(address)) {
        throw new DesignSystemExtractError("invalid_source_url", `Blocked hostname resolved to a private or local address: ${url.hostname}`);
      }
      addresses.push({ address, family });
    }
  }
  if (addresses.length === 0) throw new DesignSystemExtractError("website_fetch_failed", "Website hostname has no verifiable public address");
  return addresses;
}

export function pinnedImportRequest(url: URL, address: ImportAddress, options: WebsiteFetchOptions): { readonly url: URL; readonly init: BunFetchRequestInit } {
  const target = new URL(url);
  target.hostname = address.family === 6 ? `[${address.address}]` : address.address;
  const hostname = normalizeImportHostname(url.hostname);
  return {
    url: target,
    init: {
      redirect: "manual", signal: options.signal, keepalive: false,
      headers: { host: url.host, "user-agent": options.userAgent, ...qaAdapterRequestHeaders(url) },
      tls: { rejectUnauthorized: true, ...(isIP(hostname) === 0 ? { serverName: hostname } : {}), checkServerIdentity: (_name, certificate) => checkServerIdentity(hostname, certificate) },
    },
  };
}

async function requestPinnedWebsiteResource(url: URL, addresses: readonly ImportAddress[], options: WebsiteFetchOptions): Promise<Response> {
  let failure: unknown;
  for (const address of addresses) {
    throwIfAcquisitionAborted(options.signal);
    const pinned = pinnedImportRequest(url, address, options);
    try { return await fetch(pinned.url, pinned.init); }
    catch (error) { failure = error; }
  }
  throw failure ?? new DesignSystemExtractError("website_fetch_failed", "No validated website address could be reached");
}
