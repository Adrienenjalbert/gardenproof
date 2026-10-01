/**
 * Voice-note transcription.
 *
 * Anthropic models take no audio input, so transcription sits behind a small interface:
 * - OPENAI_API_KEY set  -> OpenAI-compatible Whisper endpoint (POST {OPENAI_BASE_URL}/audio/transcriptions,
 *                          model OPENAI_TRANSCRIBE_MODEL, default "whisper-1"). Works with any
 *                          OpenAI-compatible server (e.g. Groq, a self-hosted faster-whisper) via OPENAI_BASE_URL.
 * - otherwise           -> no transcription: media.transcript stays null and the content engine relies on
 *                          jobs.brief (typed notes / the simulator's text) instead.
 * Uses fetch + FormData only (no extra dependency). Failures return null and never block enrichment.
 */

export interface Transcriber {
  readonly name: string;
  transcribe(audio: Buffer, mimeType: string): Promise<string | null>;
}

export const nullTranscriber: Transcriber = {
  name: "none",
  async transcribe() {
    return null;
  },
};

export function whisperTranscriber(opts: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Transcriber {
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: "whisper",
    async transcribe(audio, mimeType) {
      const form = new FormData();
      const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mpeg") ? "mp3" : mimeType.includes("mp4") ? "m4a" : "wav";
      form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), `voice-note.${ext}`);
      form.append("model", opts.model ?? "whisper-1");
      form.append("language", "en");
      form.append("response_format", "json");
      // Domain vocabulary helps Whisper with "Indian sandstone", "pleached hornbeam", SW London places.
      form.append("prompt", "UK landscaping job notes: patio, Indian sandstone, porcelain, pleached hornbeam, raised beds, Wimbledon, Putney, Clapham.");
      try {
        const res = await doFetch(`${baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        });
        if (!res.ok) {
          console.error("[transcribe] whisper error", res.status, await res.text().catch(() => ""));
          return null;
        }
        const json = (await res.json()) as { text?: unknown };
        return typeof json.text === "string" && json.text.trim() ? json.text.trim() : null;
      } catch (err) {
        console.error("[transcribe] whisper request failed", err);
        return null;
      }
    },
  };
}

export function getTranscriber(): Transcriber {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return nullTranscriber;
  return whisperTranscriber({
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_TRANSCRIBE_MODEL,
  });
}

export async function transcribe(audio: Buffer, mimeType: string, transcriber: Transcriber = getTranscriber()): Promise<string | null> {
  return transcriber.transcribe(audio, mimeType);
}
