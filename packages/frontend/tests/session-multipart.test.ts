import { afterEach, describe, expect, mock, test } from "bun:test";
import { ApiError, bootstrapApiAuthority } from "../src/api/client";
import { preserveSessionDocuments, sendUserEvent } from "../src/api/session";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function upload(): File {
  return new File([new Uint8Array(4)], "notes.txt", { type: "text/plain" });
}

async function installAuthorizedFetch(
  handleRequest: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): Promise<void> {
  globalThis.fetch = mock(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/bootstrap") {
        return Response.json({ data: { capability: "launch-token" } });
      }
      return await handleRequest(input, init);
    },
  ) as typeof fetch;
  await bootstrapApiAuthority();
}

describe("multipart user event upload", () => {
  test("Given selected documents When originals are preserved Then only the authorized document endpoint receives the files", async () => {
    const requests: string[] = [];
    await installAuthorizedFetch(async (input, init) => {
      requests.push(String(input));
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-burnguard-capability")).toBe("launch-token");
      expect(init?.body).toBeInstanceOf(FormData);
      const files = (init?.body as FormData).getAll("files") as File[];
      expect(files.map((file) => file.name)).toEqual(["source.pdf"]);
      expect(await files[0]!.text()).toBe("original bytes");
      return Response.json({ data: { paths: ["docs/attachments/source.pdf"] } });
    });
    await preserveSessionDocuments("session-1", [new File(["original bytes"], "source.pdf")]);
    expect(requests).toEqual(["/api/sessions/session-1/documents"]);
  });

  test("Given a failed document save When the API rejects Then the caller can retain its draft and retry", async () => {
    await installAuthorizedFetch(() => Response.json({ error: { code: "save_failed", message: "Failed" } }, { status: 500 }));
    await expect(preserveSessionDocuments("session-1", [upload()])).rejects.toBeInstanceOf(ApiError);
  });

  test("Given API authority When a multipart message is sent Then the capability protects the request", async () => {
    let sentHeaders: Headers | null = null;
    await installAuthorizedFetch((_input, init) => {
      sentHeaders = new Headers(init?.headers);
      return Response.json({ data: { accepted: true } });
    });

    await sendUserEvent("session-1", {
      type: "user.message",
      text: "봐줘",
      files: [upload()],
    });

    expect(sentHeaders?.get("x-burnguard-capability")).toBe("launch-token");
  });

  test("Given a structured backend rejection When a multipart message is sent Then the typed code and details reach the caller", async () => {
    await installAuthorizedFetch(async () =>
      Response.json({ error: { code: "unsupported_file_kind", message: "Unsupported source kind", details: { files: ["notes.txt"], supported_kinds: ["pdf", "pptx"] } } }, { status: 415 }),
    );

    const failure = await sendUserEvent("session-1", { type: "user.message", text: "봐줘", files: [upload()] }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: "unsupported_file_kind", status: 415, details: { files: ["notes.txt"] } });
  });

  test("Given a non-JSON transport failure When a multipart message is sent Then it still surfaces a typed API error", async () => {
    await installAuthorizedFetch(async () =>
      new Response("gateway down", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );

    const failure = await sendUserEvent("session-1", { type: "user.message", text: "봐줘", files: [upload()] }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: "network_error", status: 502 });
  });

  test("Given a caller-supplied abort signal When a multipart message is sent Then the signal reaches the request and cancellation propagates", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | null = null;
    await installAuthorizedFetch(async (_input, init) => {
      seenSignal = init?.signal ?? null;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const pending = sendUserEvent("session-1", { type: "user.message", text: "봐줘", files: [upload()] }, { signal: controller.signal });
    controller.abort();
    const failure = await pending.then(() => null, (error: unknown) => error);

    expect(seenSignal).toBe(controller.signal);
    expect(failure).toMatchObject({ name: "AbortError" });
  });

  test("Given a successful multipart upload When it is sent Then text files and strict visual roles ride the same form request", async () => {
    let sentBody: FormData | null = null;
    await installAuthorizedFetch(async (_input, init) => {
      sentBody = init?.body instanceof FormData ? init.body : null;
      return Response.json({ data: { accepted: true } });
    });

    await sendUserEvent("session-1", {
      type: "user.message",
      text: "봐줘",
      files: [{ id: "upload-deck", file: upload(), role: "immutable_reference" }],
    });

    const form = sentBody as FormData | null;
    expect(form?.get("type")).toBe("user.message");
    expect(form?.get("text")).toBe("봐줘");
    expect(form?.getAll("files")).toHaveLength(1);
    expect(JSON.parse(String(form?.get("visual_sources")))).toEqual({
      schema_version: 1,
      sources: [{ source_type: "upload", upload_id: "upload-deck", file_index: 0, role: "immutable_reference" }],
    });
  });
});
