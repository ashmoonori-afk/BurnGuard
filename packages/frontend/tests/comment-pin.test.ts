import { expect, test } from "bun:test";
import { commentPinTitle } from "../src/components/canvas/CommentLayer";
import { useLocaleStore } from "../src/i18n/locale";
import { t } from "../src/i18n/t";

test("Given a comment without a note When the pin title is derived Then it is the localized placeholder and never the English literal", () => {
  const original = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: "zh-CN" });
  try {
    expect(commentPinTitle("", t)).toBe(t("workspace.comments.noNote"));
    expect(commentPinTitle("", t)).not.toContain("(no note)");
    expect(commentPinTitle("Make it bolder", t)).toBe("Make it bolder");
  } finally {
    useLocaleStore.setState({ locale: original });
  }
});
