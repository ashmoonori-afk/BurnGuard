import { describe, expect, test } from "bun:test";
import { MOODBOARD_LIMITS, type MoodboardItemV1 } from "@bg/shared";
import {
  moodboardFileMime,
  moodboardUsage,
  normalizeMoodboardLink,
  planMoodboardFileIntake,
  planMoodboardTransfer,
} from "../src/lib/logo-moodboard-intake";

function file(name: string, type: string, size = 4): File {
  return new File([new Uint8Array(size)], name, { type });
}

function fileItem(sizeBytes: number): MoodboardItemV1 {
  return {
    kind: "file",
    id: "a".repeat(64),
    sha256: "a".repeat(64),
    mime_type: "image/png",
    size_bytes: sizeBytes,
    original_name: "reference.png",
    fingerprint: "b".repeat(16),
    added_at: 1,
  };
}

function linkItem(url: string): MoodboardItemV1 {
  return { kind: "link", id: "c".repeat(64), url, added_at: 1 };
}

describe("moodboardFileMime", () => {
  test("Given a declared png type When resolved Then it is accepted", () => {
    expect(moodboardFileMime(file("a.png", "image/png"))).toBe("image/png");
  });

  test("Given an empty declared type and a jpeg extension When resolved Then the extension supplies the mime", () => {
    expect(moodboardFileMime(file("photo.JPEG", ""))).toBe("image/jpeg");
  });

  test("Given a gif type When resolved Then it is rejected", () => {
    expect(moodboardFileMime(file("anim.gif", "image/gif"))).toBeNull();
  });
});

describe("planMoodboardFileIntake", () => {
  test("Given room on the board When images are planned Then each is accepted", () => {
    const plan = planMoodboardFileIntake({ imageCount: 0, imageBytes: 0 }, [file("a.png", "image/png"), file("b.webp", "image/webp")]);

    expect(plan.accepted).toHaveLength(2);
    expect(plan.rejected).toHaveLength(0);
  });

  test("Given a non-image and an oversized image When planned Then both are rejected as invalid files", () => {
    const plan = planMoodboardFileIntake({ imageCount: 0, imageBytes: 0 }, [
      file("notes.txt", "text/plain"),
      file("huge.png", "image/png", MOODBOARD_LIMITS.max_file_bytes + 1),
    ]);

    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected.map((entry) => entry.reason)).toEqual(["invalid_file", "invalid_file"]);
  });

  test("Given a full board When another image is planned Then it is rejected at the limit", () => {
    const plan = planMoodboardFileIntake({ imageCount: MOODBOARD_LIMITS.max_files, imageBytes: 0 }, [file("one.png", "image/png")]);

    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0]?.reason).toBe("limit_reached");
  });

  test("Given nearly full total bytes When a file crosses the ceiling Then only within-budget files are accepted", () => {
    const plan = planMoodboardFileIntake({ imageCount: 0, imageBytes: MOODBOARD_LIMITS.max_total_bytes - 2 }, [
      file("small.png", "image/png", 1),
      file("over.png", "image/png", 4),
    ]);

    expect(plan.accepted.map((entry) => entry.name)).toEqual(["small.png"]);
    expect(plan.rejected.map((entry) => entry.reason)).toEqual(["limit_reached"]);
  });
});

describe("normalizeMoodboardLink", () => {
  test("Given a public https url When normalized Then it is trimmed and returned", () => {
    expect(normalizeMoodboardLink("  https://example.com/a  ")).toBe("https://example.com/a");
  });

  test("Given a non-https, credentialed, or spaced url When normalized Then it is rejected", () => {
    expect(normalizeMoodboardLink("http://example.com")).toBeNull();
    expect(normalizeMoodboardLink("https://user:pass@example.com")).toBeNull();
    expect(normalizeMoodboardLink("https://exa mple.com")).toBeNull();
    expect(normalizeMoodboardLink("javascript:alert(1)")).toBeNull();
    expect(normalizeMoodboardLink("")).toBeNull();
  });

  test("Given a url past the schema bound When normalized Then it is rejected", () => {
    expect(normalizeMoodboardLink(`https://example.com/${"a".repeat(MOODBOARD_LIMITS.max_url_chars)}`)).toBeNull();
  });
});

describe("planMoodboardTransfer", () => {
  test("Given a uri-list with a comment line When classified Then only real links survive and duplicates collapse", () => {
    const plan = planMoodboardTransfer({ files: [], uriList: "# comment\nhttps://example.com/a\nhttps://example.com/a", text: "" });

    expect(plan.links).toEqual(["https://example.com/a"]);
  });

  test("Given a dropped non-image file When classified Then it is filtered out", () => {
    const plan = planMoodboardTransfer({ files: [file("a.png", "image/png"), file("b.txt", "text/plain")], uriList: "", text: "" });

    expect(plan.files.map((entry) => entry.name)).toEqual(["a.png"]);
  });
});

describe("moodboardUsage", () => {
  test("Given a mixed board When measured Then file and link counts and bytes are separated", () => {
    expect(moodboardUsage([fileItem(10), fileItem(32), linkItem("https://example.com")])).toEqual({ imageCount: 2, imageBytes: 42, linkCount: 1 });
  });
});
