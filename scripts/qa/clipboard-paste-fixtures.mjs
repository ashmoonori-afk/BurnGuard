import assert from "node:assert/strict";

/** Exercise native clipboard events through the actual composer and upload path. */
export async function runClipboardPasteFixture(page, context) {
  const composer = page.locator('[data-qa="composer"]');
  const input = composer.locator("textarea");
  const attachments = composer.locator(":scope > ul > li");
  const initialText = await input.inputValue();
  const initialCount = await attachments.count();
  const paste = process.platform === "darwin" ? "Meta+v" : "Control+v";
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const drawing = canvas.getContext("2d");
    drawing.fillStyle = "#004fff";
    drawing.fillRect(0, 0, 2, 2);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  });
  try {
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
    while (await attachments.count() > initialCount) await attachments.last().getByRole("button").click();
    await input.fill(initialText);
    await context.clearPermissions();
  }
}
