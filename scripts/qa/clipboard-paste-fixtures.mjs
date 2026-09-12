import assert from "node:assert/strict";

export async function captureClipboard(page) {
  return page.evaluate(async () => {
    const items = await Promise.all((await navigator.clipboard.read()).map(async item => ({
      types: await Promise.all(item.types.map(async type => ({ type, bytes: [...new Uint8Array(await (await item.getType(type)).arrayBuffer())] }))),
    })));
    return items.filter(item => item.types.length > 0);
  });
}

export async function restoreClipboard(page, snapshot) {
  await page.evaluate(async items => {
    if (items.length === 0) return navigator.clipboard.writeText("");
    await navigator.clipboard.write(items.map(item => new ClipboardItem(Object.fromEntries(
      item.types.map(({ type, bytes }) => [type, new Blob([Uint8Array.from(bytes)], { type })]),
    ))));
  }, snapshot);
}

/** Exercise native clipboard events through the actual composer and upload path. */
export async function runClipboardPasteFixture(page, context) {
  const composer = page.locator('[data-qa="composer"]');
  const input = composer.locator("textarea");
  const attachments = composer.locator(":scope > ul > li");
  const initialText = await input.inputValue();
  const initialCount = await attachments.count();
  const paste = process.platform === "darwin" ? "Meta+v" : "Control+v";
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let snapshot;
  try {
    snapshot = await captureClipboard(page);
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      const drawing = canvas.getContext("2d");
      drawing.fillStyle = "#004fff";
      drawing.fillRect(0, 0, 2, 2);
      const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    });
    await input.focus();
    await page.keyboard.press(paste);
    await attachments.nth(initialCount).waitFor({ timeout: 5_000 });
    assert.equal(await attachments.count(), initialCount + 1, "one paste must create exactly one attachment");
    const added = attachments.nth(initialCount);
    assert.equal(await added.locator("select").count(), 1, "pasted PNG must be accepted by normal attachment intake");
    await page.evaluate(() => navigator.clipboard.writeText("clipboard text regression"));
    await input.fill("");
    await page.keyboard.press(paste);
    assert.equal(await input.inputValue(), "clipboard text regression", "text-only paste must remain native");
    assert.equal(await attachments.count(), initialCount + 1, "text paste must not duplicate image attachments");
  } finally {
    try {
      while (await attachments.count() > initialCount) await attachments.last().getByRole("button").click();
      await input.fill(initialText);
    } finally {
      try { if (snapshot) await restoreClipboard(page, snapshot); }
      finally { await context.clearPermissions(); }
    }
  }
}
