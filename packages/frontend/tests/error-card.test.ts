import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorCard from "../src/components/chat/blocks/ErrorCard";
import { LOCALES, useLocaleStore } from "../src/i18n/locale";
import { t } from "../src/i18n/t";
import { apiErrorCopy } from "../src/lib/error-copy";

test("Given a raw provider failure When modeled for UI Then no host path renders and the input recovery action remains available", () => {
  const raw = "/private/Users/alice/project/.attachments/source.pdf";
  const html = renderToStaticMarkup(createElement(ErrorCard, {
    message: raw,
    code: "path_unavailable",
    recoverable: true,
  }));
  expect(html).not.toContain(raw);
  expect(html).not.toContain("/private/");
  expect(html.match(/<button/g)?.length).toBe(1);
  expect(html).toContain(t("chat.error.focusComposer"));
});

test("Given stage errors When rendered in every locale Then fixed stage copy replaces raw diagnostics", () => {
  const initial = useLocaleStore.getInitialState();
  const originalInitial = initial.locale;
  const original = useLocaleStore.getState().locale;
  const stages = [
    ["design_review_failed", "chat.error.designReviewFailed", "errors.design_review_failed"],
    ["logo_image_provenance_missing", "chat.error.logoImageProvenanceMissing", "errors.logo_image_provenance_missing"],
    ["logo_deliverables_missing", "chat.error.logoDeliverablesMissing", "errors.logo_deliverables_missing"],
  ] as const;
  try {
    for (const locale of LOCALES) {
      Object.assign(initial, { locale });
      useLocaleStore.setState({ locale });
      for (const [code, chatKey, apiKey] of stages) {
        const raw = "fixture-private-diagnostic /private/fixture/config.toml";
        const html = renderToStaticMarkup(createElement(ErrorCard, { code, message: raw, recoverable: true }));
        const shipped = renderToStaticMarkup(createElement("span", null, t(chatKey))).replace(/^<span>|<\/span>$/g, "");
        expect(html).toContain(shipped);
        expect(html).not.toContain(raw);
        expect(html).not.toContain(code);
        expect(apiErrorCopy({ code, message: raw })).toBe(t(apiKey));
      }
    }
  } finally {
    Object.assign(initial, { locale: originalInitial });
    useLocaleStore.setState({ locale: original });
  }
});
