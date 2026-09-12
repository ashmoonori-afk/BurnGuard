import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { captureClipboard, runClipboardPasteFixture } from "./clipboard-paste-fixtures.mjs";

test("empty clipboard items do not become invalid restoration dictionaries", async () => {
  const page = {
    evaluate: callback => runInNewContext(`(${callback.toString()})()`, {
      navigator: { clipboard: { read: async () => [{ types: [] }] } },
    }),
  };
  expect(await captureClipboard(page)).toEqual([]);
});

test("clipboard capture failure aborts before overwriting and releases permissions", async () => {
  const failure = new Error("Clipboard capture unavailable");
  let writes = 0, cleared = 0;
  const input = { inputValue: async () => "owned draft", fill: async () => {} };
  const attachments = { count: async () => 0 };
  const clipboard = {
    read: async () => { throw failure; },
    write: async () => { writes++; },
    writeText: async () => { writes++; },
  };
  const page = {
    locator: () => ({ locator: selector => selector === "textarea" ? input : attachments }),
    evaluate: callback => runInNewContext(`(${callback.toString()})()`, { navigator: { clipboard } }),
  };
  const context = {
    grantPermissions: async () => {},
    clearPermissions: async () => { cleared++; },
  };
  await expect(runClipboardPasteFixture(page, context)).rejects.toBe(failure);
  expect(writes).toBe(0);
  expect(cleared).toBe(1);
});
