type CloseBrowser = () => Promise<void>;
export type ExportBrowserClosePolicy = { readonly gracefulDeadlineMs: number };
const DEFAULT_CLOSE_POLICY: ExportBrowserClosePolicy = { gracefulDeadlineMs: 5_000 };
const active = new Map<symbol, CloseBrowser>();

export type ExportBrowserOwner = { readonly close: () => Promise<void>; readonly release: () => void };

export function registerExportBrowser(closeBrowser: CloseBrowser, policy: ExportBrowserClosePolicy = DEFAULT_CLOSE_POLICY): ExportBrowserOwner {
  const id = Symbol("export-browser"); let closing: Promise<void> | null = null;
  const close = async (): Promise<void> => { closing ??= terminateBrowser(closeBrowser, policy); try { await closing; } finally { active.delete(id); } };
  active.set(id, close); return { close, release: () => { active.delete(id); } };
}

export function activeExportBrowserCount(): number { return active.size; }

export async function closeActiveExportBrowsers(): Promise<void> {
  const owners = [...active.values()]; const failures: unknown[] = [];
  await Promise.all(owners.map(async (close) => { try { await close(); } catch (error) { failures.push(error); } }));
  if (failures.length > 0) throw new AggregateError(failures, "Failed to close active export browsers");
}

async function terminateBrowser(close: CloseBrowser, policy: ExportBrowserClosePolicy): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null; const deadline = new Promise<"deadline">((resolve) => { timeout = setTimeout(() => resolve("deadline"), policy.gracefulDeadlineMs); }); let result: "closed" | "deadline";
  try { result = await Promise.race([close().then(() => "closed" as const), deadline]); }
  catch (error) { try { await close(); } catch (forceError) { throw new AggregateError([error, forceError], "Chromium graceful and forced close both failed"); } throw error; }
  finally { if (timeout !== null) clearTimeout(timeout); }
  if (result === "deadline") await close();
}
