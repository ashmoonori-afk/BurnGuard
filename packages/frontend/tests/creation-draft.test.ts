import { describe, expect, test } from "bun:test";
import { INITIAL_BRIEF_FORM } from "../src/lib/project-creation";
import {
  CREATION_DRAFT_KEY,
  parseCreationDraft,
  serializeCreationDraft,
} from "../src/lib/creation-draft";

describe("new project draft survival", () => {
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
  });
});
