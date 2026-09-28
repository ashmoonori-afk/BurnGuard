import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectBundleControl } from "../src/components/project/ProjectBundleButton";
import { t } from "../src/i18n/t";

test("Given an export in flight When the project bundle control renders Then duplicate submission is disabled and explicit", () => {
  // Given / When
  const html = renderToStaticMarkup(createElement(ProjectBundleControl, {
    pending: true,
    onExport() {},
  }));

  // Then
  expect(html).toContain('disabled=""');
  expect(html).toContain(t("export.projectBundlePending"));
});
