import { describe, expect, test } from "bun:test";
import { installLeaveGuard } from "../src/lib/leave-guard";

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
});
