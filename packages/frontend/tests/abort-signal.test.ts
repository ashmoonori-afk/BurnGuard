import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { anySignal } from "../src/lib/abort-signal";

/** WebKit before 17.4 (macOS 14.0-14.3 WKWebView) has no AbortSignal.any. */
function withoutNativeAny<T>(action: () => T): T {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true, writable: true });
  try { return action(); }
  finally { if (original) Object.defineProperty(AbortSignal, "any", original); }
}

test("Given AbortSignal.any is unavailable When one input aborts Then the composed signal aborts with that input's reason", () => {
  withoutNativeAny(() => {
    const first = new AbortController();
    const second = new AbortController();
    const composed = anySignal([first.signal, second.signal]);
    expect(composed.aborted).toBe(false);
    const reason = new Error("first_reason");
    second.abort(reason);
    expect(composed.aborted).toBe(true);
    expect(composed.reason).toBe(reason);
    first.abort(new Error("later_reason"));
    expect(composed.reason).toBe(reason);
  });
});

test("Given AbortSignal.any is unavailable When an input is already aborted Then the composed signal starts aborted with its reason", () => {
  withoutNativeAny(() => {
    const reason = new Error("already_aborted");
    const composed = anySignal([new AbortController().signal, AbortSignal.abort(reason)]);
    expect(composed.aborted).toBe(true);
    expect(composed.reason).toBe(reason);
  });
});

test("Given AbortSignal.any is unavailable When no input aborts Then the composed signal stays live", () => {
  withoutNativeAny(() => {
    expect(anySignal([new AbortController().signal, new AbortController().signal]).aborted).toBe(false);
  });
});

test("Given AbortSignal.any exists When signals are composed Then the native implementation is used", () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  const native = new AbortController().signal;
  const calls: AbortSignal[][] = [];
  Object.defineProperty(AbortSignal, "any", { value: (signals: AbortSignal[]) => { calls.push(signals); return native; }, configurable: true, writable: true });
  try {
    const inputs = [new AbortController().signal];
    expect(anySignal(inputs)).toBe(native);
    expect(calls).toEqual([inputs]);
  } finally { if (original) Object.defineProperty(AbortSignal, "any", original); }
});

test("Given frontend sources When audited Then AbortSignal.any is only reached through the guarded helper", async () => {
  const sourceRoot = path.join(import.meta.dir, "../src");
  const direct: string[] = [];
  for await (const relative of new Glob("**/*.{ts,tsx}").scan(sourceRoot)) {
    if (relative.replaceAll("\\", "/") === "lib/abort-signal.ts") continue;
    if ((await readFile(path.join(sourceRoot, relative), "utf8")).includes("AbortSignal.any(")) direct.push(relative);
  }
  expect(direct).toEqual([]);
});
