import { expect, test } from "bun:test";
import { createPagePrompt, mergeComposerPrefill } from "../src/lib/create-page-prompt";
import { useLocaleStore } from "../src/i18n/locale";
import { t } from "../src/i18n/t";

test("Given the zh-CN locale When the create-page prompt is produced Then it names both pages in the active locale", () => {
  const original = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: "zh-CN" });
  try {
    const prompt = createPagePrompt("about.html", "index.html");
    expect(prompt).toBe(t("workspace.project.createPagePrompt", { page: "about.html", from: "index.html" }));
    expect(prompt).toContain("about.html");
    expect(prompt).toContain("index.html");
    expect(prompt).not.toContain("Create");
  } finally {
    useLocaleStore.setState({ locale: original });
  }
});

test("Given a draft the user already typed When a prefill arrives Then it is appended after a blank line instead of replacing the draft", () => {
  expect(mergeComposerPrefill("my text", "prompt")).toBe("my text\n\nprompt");
  expect(mergeComposerPrefill("my text", "prompt").startsWith("my text")).toBe(true);
  expect(mergeComposerPrefill("", "prompt")).toBe("prompt");
  expect(mergeComposerPrefill("   \n", "prompt")).toBe("prompt");
  expect(mergeComposerPrefill("my text", "")).toBe("my text");
});
