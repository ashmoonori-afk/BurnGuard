import { expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesignSystemColorToken } from "@bg/shared";
import { ColorTokenEditor } from "../src/views/DesignSystemView";
import { resolveTokenColor } from "../src/lib/token-color";

const tokens: DesignSystemColorToken[] = [{ name: "gray-100", value: "#F5F5F5" }, { name: "bg", value: "var(--gray-100)" }, { name: "x", value: "var(--missing)" }, { name: "loop-a", value: "var(--loop-b)" }, { name: "loop-b", value: "var(--loop-a)" }, { name: "fallback", value: "var(--missing, #123456)" }];

function editor(editingToken: DesignSystemColorToken): string {
  return renderToStaticMarkup(createElement(ColorTokenEditor, {
    refEl: createRef<HTMLDivElement>(), tokens, tokenFilePath: "colors.css",
    editingToken, open: true, name: editingToken.name, value: editingToken.value, saving: false,
    onAdd() {}, onEdit() {}, onNameChange() {}, onValueChange() {}, onSave() {}, onCancel() {},
  }));
}
const colorInput = (html: string) => html.match(/<input type="color"[^>]*>/)?.[0] ?? "";
const swatch = (html: string, name: string) => html.match(new RegExp(`<div class="h-8 w-8[^>]*></div><div class="min-w-0 flex-1"><div class="truncate font-mono text-xs">--${name}<`))?.[0] ?? "";
const swatchStyle = (html: string, name: string) => swatch(html, name).match(/style="([^"]*)"/)?.[1] ?? "";

test("Given var() chains When a token colour is resolved Then literals come back, unresolvable and cyclic references do not, and a fallback is honoured (CSS-13)", () => {
  expect(resolveTokenColor("var(--gray-100)", tokens)).toBe("#F5F5F5");
  expect(resolveTokenColor("#0057B8", tokens)).toBe("#0057B8");
  expect(resolveTokenColor("var(--missing)", tokens)).toBeNull();
  expect(resolveTokenColor("var(--loop-a)", tokens)).toBeNull();
  expect(resolveTokenColor("var(--missing, #123456)", tokens)).toBe("#123456");
  expect(resolveTokenColor("var( --bg )", tokens)).toBe("#F5F5F5");
});

test("Given a token aliasing another When the editor renders Then the swatch shows the resolved colour and the picker carries it", () => {
  const html = editor(tokens[1]!);
  expect(swatchStyle(html, "bg")).toContain("#F5F5F5");
  expect(colorInput(html)).toContain('value="#f5f5f5"');
  expect(colorInput(html)).not.toContain('disabled=""');
});

test("Given a token whose reference cannot be resolved When the editor renders Then the swatch is marked unresolved and the picker is disabled so a stray click cannot write black", () => {
  const html = editor(tokens[2]!);
  expect(swatch(html, "x")).toContain("data-unresolved");
  expect(swatchStyle(html, "x")).not.toContain("var(");
  expect(colorInput(html)).toContain('disabled=""');
});
