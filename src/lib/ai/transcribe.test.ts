import { afterEach, describe, expect, it, vi } from "vitest";
import { getTranscriber, nullTranscriber, whisperTranscriber } from "./transcribe";

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
});

describe("transcription", () => {
  it("defaults to no transcription without OPENAI_API_KEY", async () => {
    expect(getTranscriber().name).toBe("none");
    expect(await nullTranscriber.transcribe(Buffer.from("x"), "audio/ogg")).toBeNull();
  });

  it("uses Whisper when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(getTranscriber().name).toBe("whisper");
  });

  it("posts multipart audio to the OpenAI-compatible endpoint and returns the text", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://example.test/v1/audio/transcriptions");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("whisper-1");
      expect((form.get("file") as File).name).toBe("voice-note.ogg");
      return new Response(JSON.stringify({ text: " Laid the sandstone patio. " }), { status: 200 });
    });
    const t = whisperTranscriber({ apiKey: "k", baseUrl: "https://example.test/v1/", fetchImpl: fetchImpl as typeof fetch });
    expect(await t.transcribe(Buffer.from("audio"), "audio/ogg")).toBe("Laid the sandstone patio.");
  });

  it("returns null (never throws) on API errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const t = whisperTranscriber({ apiKey: "k", fetchImpl: fetchImpl as typeof fetch });
    expect(await t.transcribe(Buffer.from("audio"), "audio/mpeg")).toBeNull();
  });
});
