import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorCard from "../src/components/chat/blocks/ErrorCard";

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
  expect(html).toContain("메시지 입력으로 이동");
});
