import { expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FileTree from "../src/components/files/FileTree";
import BackendSelector from "../src/components/settings/BackendSelector";
import { ColorTokenEditor } from "../src/views/DesignSystemView";
import { groupSystemPreviews } from "../src/components/systems/SystemPreviewGrid";

test("Given an open new color editor When the entire name is cleared Then the editor remains with a named invalid input and a disabled save action", () => {
  const html = renderToStaticMarkup(createElement(ColorTokenEditor, {
    refEl: createRef<HTMLDivElement>(), tokens: [], tokenFilePath: null,
    editingToken: null, open: true, name: "", value: "#0057B8", saving: false,
    onAdd() {}, onEdit() {}, onNameChange() {}, onValueChange() {}, onSave() {}, onCancel() {},
  }));
  expect(html).toContain('id="system-color-editor"');
  expect(html).toContain('for="system-color-name"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>색상 저장<\/button>/);
  expect(html).toContain('aria-label="색상 선택"');
});

test("Given two available backends When one is selected Then assistive technology receives the selection state independently of color", () => {
  const html = renderToStaticMarkup(createElement(BackendSelector, {
    value: "codex", onChange() {},
    detection: {
      backends: [
        { id: "claude-code", found: true, binary_path: "claude", version: "1" },
        { id: "codex", found: true, binary_path: "C:/private/tools/codex.exe", version: "1" },
      ],
    },
  }));
  expect(html).toContain('aria-labelledby="backend-selector-label"');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
  expect(html).toContain("Claude Code");
  expect(html).toContain("Codex");
  expect(html).not.toContain("C:/private/tools");
});

test("Given only one standard preview and a custom preview When grouped Then absent sections stay absent and both existing files remain", () => {
  expect(groupSystemPreviews([])).toEqual([]);
  expect(groupSystemPreviews([{ path: "preview/colors-brand.html" }, { path: "preview/mobile-header.html" }])).toEqual([
    { group: "색상", items: [{ path: "preview/colors-brand.html", title: "브랜드 색상" }] },
    { group: "기타 미리보기", items: [{ path: "preview/mobile-header.html", title: "mobile header" }] },
  ]);
});


test("Given a selected project file When the file browser renders Then its current item and complete path are available to keyboard and screen-reader users", () => {
  const html = renderToStaticMarkup(createElement(FileTree, {
    files: [{ rel_path: "styles/brand.css", category: "stylesheet" }, { rel_path: "notes/brief.md", category: "document" }],
    activePath: "styles/brand.css", onOpen() {},
  }));
  expect(html).toContain('aria-label="프로젝트 파일 탐색"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain('title="styles/brand.css"');
  expect(html).toContain('title="notes/brief.md"');
});
