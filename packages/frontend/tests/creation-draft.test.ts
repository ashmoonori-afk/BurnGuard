import { afterEach, describe, expect, test } from "bun:test";
import { INITIAL_BRIEF_FORM, buildCreateProjectRequest } from "../src/lib/project-creation";
import {
  CREATION_DRAFT_KEY,
  clearCreationDraft,
  parseCreationDraft,
  readCreationDraft,
  serializeCreationDraft,
  writeCreationDraft,
} from "../src/lib/creation-draft";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  return store;
}

afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else Object.defineProperty(globalThis, "window", originalWindow);
});

describe("draft cleared after a successful create (UX-03)", () => {
  test("Given a stored draft When the draft is cleared Then the key is gone and the empty form is read back", () => {
    const store = installStorage();
    writeCreationDraft("slide_deck", { ...INITIAL_BRIEF_FORM, name: "분기 리뷰 덱" });
    expect(store.has(CREATION_DRAFT_KEY("slide_deck"))).toBe(true);

    clearCreationDraft("slide_deck");

    expect(store.has(CREATION_DRAFT_KEY("slide_deck"))).toBe(false);
    expect(readCreationDraft("slide_deck")).toEqual(INITIAL_BRIEF_FORM);
  });

  test("Given blocked storage When the draft is cleared Then the panel keeps working", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw new DOMException("Access is denied for this document.", "SecurityError"); } } });
    expect(() => clearCreationDraft("graphic")).not.toThrow();
  });

  test("Given the creation panel source When scanned Then the draft is cleared on success before the panel unmounts through onCreated", async () => {
    const source = await Bun.file(new URL("../src/components/home/NewProjectPanel.tsx", import.meta.url)).text();
    const clearedAt = source.indexOf("clearCreationDraft(type)");
    const createdAt = source.indexOf("onCreated(created)");
    expect(clearedAt).toBeGreaterThan(-1);
    expect(clearedAt).toBeLessThan(createdAt);
  });
});

describe("banner set frame count recovery (UX-34)", () => {
  test("Given a stored banner set whose frame count was cleared When read Then the count follows the restored frames and the draft builds", () => {
    const frames = [{ width: 1080, height: 1080, label: "정사각형" }, { width: 1200, height: 628, label: "가로형" }, { width: 1080, height: 1920, label: "세로형" }];
    const stored = JSON.stringify({ ...INITIAL_BRIEF_FORM, name: "배너 세트", audience: "쇼핑몰 방문자", objective: "봄 세일 안내", graphicKind: "banner_set", frameCount: null, frames });

    const form = parseCreationDraft(stored);

    expect(form.frameCount).toBe(3);
    expect(form.frames).toEqual(frames);
    expect(buildCreateProjectRequest({ ...form, type: "graphic", backendId: "claude-code", designSystemId: null }, []).ok).toBe(true);
  });

  test("Given a stored banner set with a valid count When read Then the stored count is kept as entered", () => {
    const stored = JSON.stringify({ ...INITIAL_BRIEF_FORM, graphicKind: "banner_set", frameCount: 2, frames: [{ width: 1080, height: 1080, label: "" }] });
    expect(parseCreationDraft(stored).frameCount).toBe(2);
  });
});

describe("new project draft survival", () => {
  test("Given an explicit deck restructuring choice When saved and restored Then the choice survives", () => {
    const entered = { ...INITIAL_BRIEF_FORM, sourcePageMapping: "restructure" as const };
    expect(parseCreationDraft(serializeCreationDraft(entered))).toEqual(entered);
  });

  test("Given entered graphic set values When serialized and read back Then every answer returns", () => {
    const entered = {
      ...INITIAL_BRIEF_FORM,
      name: "가을 신상 카드뉴스",
      graphicKind: "product_detail" as const,
      frameCount: 1,
      presetId: "smartstore-product-detail",
      detailBrief: { persona_pain: "재고를 손으로 세요" },
      graphicWidth: 860,
      graphicHeight: 12_000,
    };

    expect(parseCreationDraft(serializeCreationDraft(entered))).toEqual(entered);
  });

  test("Given entered logo brief values When serialized and read back Then every answer returns", () => {
    const entered = {
      ...INITIAL_BRIEF_FORM,
      name: "온새미로 로고",
      logoBrandName: "온새미로",
      logoNiche: "유기농 베이커리",
      logoCharacter: ["따뜻한", "정직한"],
      logoType: "combination" as const,
      logoSymbolKeywords: ["밀 이삭"],
      logoAvoid: "흔한 방패 문양은 피해 주세요",
    };

    expect(parseCreationDraft(serializeCreationDraft(entered))).toEqual(entered);
  });

  test("Given a stored logo type the build no longer knows When read Then the automatic type is used", () => {
    const stored = JSON.stringify({ logoType: "hologram", logoCharacter: ["따뜻한", 7] });

    expect(parseCreationDraft(stored)).toEqual(INITIAL_BRIEF_FORM);
  });

  test("Given no stored draft or unreadable storage When read Then the empty form is used", () => {
    expect(parseCreationDraft(null)).toEqual(INITIAL_BRIEF_FORM);
    expect(parseCreationDraft("{not json")).toEqual(INITIAL_BRIEF_FORM);
    expect(parseCreationDraft("[]")).toEqual(INITIAL_BRIEF_FORM);
  });

  test("Given a draft written by an older build When read Then known fields survive and missing ones fall back", () => {
    const stored = JSON.stringify({ name: "이전 초안", frameCount: 8, unknownField: 1 });

    expect(parseCreationDraft(stored)).toEqual({
      ...INITIAL_BRIEF_FORM,
      name: "이전 초안",
      frameCount: 8,
    });
  });

  test("Given a draft with impossible types When read Then those fields fall back instead of throwing", () => {
    const stored = JSON.stringify({ name: 12, frameCount: "여덟", detailBrief: "없음", frames: { width: 1 } });

    expect(parseCreationDraft(stored)).toEqual(INITIAL_BRIEF_FORM);
  });

  test("Given a project type When the storage key is built Then drafts never mix between types", () => {
    expect(CREATION_DRAFT_KEY("graphic")).not.toBe(CREATION_DRAFT_KEY("slide_deck"));
    expect(CREATION_DRAFT_KEY("graphic")).toContain("graphic");
    expect(CREATION_DRAFT_KEY("logo")).not.toBe(CREATION_DRAFT_KEY("graphic"));
    expect(CREATION_DRAFT_KEY("logo")).toContain("logo");
  });
});
