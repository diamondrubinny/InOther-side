/**
 * Speech-to-text for the legator's own recordings (Hebrew first).
 * Real adapters must be checked against the server's / vendor's official documentation.
 */
export interface Transcriber {
  readonly name: string;
  transcribe(audio: Buffer, mime: string, language: string): Promise<{ text: string; language: string }>;
}

/**
 * OpenAI-compatible transcription endpoint (multipart POST /v1/audio/transcriptions with
 * fields file, model, language; JSON response { text }). Implemented by several self-hosted
 * Whisper servers. 🔎 Verify field names and limits against your server's docs before use.
 */
export class OpenAiCompatibleTranscriber implements Transcriber {
  readonly name = "openai_compatible";
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs: number,
  ) {}

  async transcribe(audio: Buffer, mime: string, language: string): Promise<{ text: string; language: string }> {
    const form = new FormData();
    const ext = mime.split("/")[1]?.replace("mpeg", "mp3").replace("x-", "") ?? "bin";
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `recording.${ext}`);
    form.append("model", this.model);
    form.append("language", language);
    form.append("response_format", "json");
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/audio/transcriptions`, {
      method: "POST",
      body: form,
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`transcriber responded ${res.status}`);
    const data = (await res.json()) as { text?: unknown };
    if (typeof data.text !== "string") throw new Error("transcriber returned no text");
    return { text: data.text.trim(), language };
  }
}

/**
 * Offline stand-in for development and tests: if the file contains an ASCII marker
 * "TRANSCRIPT:<utf8 text>:END" it returns that text, otherwise a fixed placeholder.
 */
export class MockTranscriber implements Transcriber {
  readonly name = "mock";
  async transcribe(audio: Buffer, _mime: string, language: string): Promise<{ text: string; language: string }> {
    const raw = audio.toString("utf8");
    const m = /TRANSCRIPT:([\s\S]*?):END/.exec(raw);
    return { text: m?.[1]?.trim() ?? "(תמלול לדוגמה)", language };
  }
}
