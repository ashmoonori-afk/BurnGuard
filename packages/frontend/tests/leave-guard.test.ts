import { describe, expect, test } from "bun:test";
import { installLeaveGuard, reloadWithoutLeaveGuard } from "../src/lib/leave-guard";

const unload = (target: EventTarget) => {
  const event = new Event("beforeunload", { cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("leave guard while a turn runs (B3-5)", () => {
  test("Given an installed guard When the page is about to unload Then the unload is cancelled so the browser asks first", () => {
    const target = new EventTarget();
    const uninstall = installLeaveGuard(target as unknown as Window);
    expect(unload(target).defaultPrevented).toBe(true);
    uninstall();
  });

  test("Given the guard was uninstalled When the page unloads Then it leaves without a prompt", () => {
    const target = new EventTarget();
    installLeaveGuard(target as unknown as Window)();
    expect(unload(target).defaultPrevented).toBe(false);
  });

  test("Given the project view source When scanned Then the guard is installed only while the composer is busy with a turn", async () => {
    const source = await Bun.file(new URL("../src/views/ProjectView.tsx", import.meta.url)).text();
    expect(source).toContain("useEffect(() => (chatComposerDisabled ? installLeaveGuard() : undefined), [chatComposerDisabled]);");
  });

  test("Given an installed guard When the app reloads itself Then the guard is disarmed before the reload so no prompt shows", () => {
    const target = new EventTarget();
    installLeaveGuard(target as unknown as Window);
    let promptedDuringReload: boolean | null = null;
    const location = { reload: () => { promptedDuringReload = unload(target).defaultPrevented; } };

    reloadWithoutLeaveGuard(target as unknown as Window, location);

    expect(promptedDuringReload === false).toBe(true);
  });

  test("Given the frontend source When scanned Then app-initiated reloads go through the helper and nothing else calls location.reload", async () => {
    const root = new URL("../src/", import.meta.url).pathname;
    const offenders: string[] = [];
    for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan(root)) {
      if (file === "lib/leave-guard.ts") continue;
      if ((await Bun.file(root + file).text()).includes("location.reload")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
    for (const file of ["components/Bootstrap.tsx", "components/settings/SettingsModal.tsx"]) {
      expect(await Bun.file(root + file).text()).toContain("reloadWithoutLeaveGuard()");
    }
  });
});
