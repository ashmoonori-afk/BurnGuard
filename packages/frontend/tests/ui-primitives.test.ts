import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Inbox } from "lucide-react";
import { Button } from "../src/components/ui/button";
import { EmptyState } from "../src/components/ui/empty-state";
import { Skeleton } from "../src/components/ui/skeleton";
import { Spinner } from "../src/components/ui/spinner";
import { Tooltip } from "../src/components/ui/tooltip";

describe("ui primitives", () => {
  test("Given an open Tooltip When rendered Then the trigger is described by a tooltip element with the same id", () => {
    const html = renderToStaticMarkup(createElement(Tooltip, { content: "Label", defaultOpen: true }, createElement("button", { type: "button" }, "x")));
    const tooltipId = /role="tooltip" id="([^"]+)"/.exec(html)?.[1];
    expect(tooltipId).toBeDefined();
    expect(html).toContain(`aria-describedby="${tooltipId}"`);
  });

  test("Given a closed Tooltip When rendered Then no tooltip element or description is present", () => {
    const html = renderToStaticMarkup(createElement(Tooltip, { content: "Label" }, createElement("button", { type: "button" }, "x")));
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain("aria-describedby");
  });

  test("Given a Spinner When rendered Then it is a status region named by the label and the icon is hidden", () => {
    const html = renderToStaticMarkup(createElement(Spinner, { label: "Loading" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Loading");
  });

  test("Given a Skeleton When rendered Then it is hidden from assistive technology and takes the passed size", () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { className: "h-4 w-24" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("h-4 w-24");
  });

  test("Given an EmptyState with icon, body and action When rendered Then it renders a heading and the action", () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { icon: Inbox, title: "Nothing here", body: "Add one", action: createElement("button", { type: "button", id: "next" }) }));
    expect(html).toContain("data-empty-state");
    expect(html).toContain("<h3");
    expect(html).toContain('id="next"');
    expect(html).toContain("<svg");
  });

  test("Given a disabled Button of each variant When rendered Then it uses the one muted disabled style and no opacity fade", () => {
    for (const variant of ["default", "destructive", "outline", "secondary", "cta", "ghost", "link"] as const) {
      const html = renderToStaticMarkup(createElement(Button, { variant, disabled: true }, "Go"));
      expect(html).toContain("disabled:text-muted-foreground");
      expect(html).not.toContain("disabled:opacity");
    }
  });

  test("Given a Button When rendered Then it carries the shared focus ring recipe", () => {
    const html = renderToStaticMarkup(createElement(Button, {}, "Go"));
    for (const klass of ["focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2", "focus-visible:ring-offset-background"]) expect(html).toContain(klass);
  });
});
