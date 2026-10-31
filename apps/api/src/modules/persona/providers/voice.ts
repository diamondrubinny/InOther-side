/**
 * Voice cloning + speech synthesis, behind an interface so a real vendor can be plugged in.
 * Any real vendor must be verified against its official docs, ToS (cloning a consenting
 * person's voice for posthumous use) and a signed DPA before use.
 */
export interface VoiceProvider {
  readonly name: string;
  /** Creates a voice from the legator's own recordings; returns an opaque provider reference. */
  cloneVoice(samples: Buffer[], label: string): Promise<string>;
  /** Synthesizes text in the given voice (or a standard voice when voiceRef is null). */
  synthesize(voiceRef: string | null, text: string, locale: string): Promise<{ audio: Buffer; mime: string }>;
  deleteVoice(voiceRef: string): Promise<void>;
}

/**
 * Offline stand-in: produces a WAV whose loudness follows the text's syllable rhythm, so the
 * browser avatar's lip-sync can be developed and tested end to end without a vendor.
 */
export class MockVoice implements VoiceProvider {
  readonly name = "mock";

  async cloneVoice(samples: Buffer[]): Promise<string> {
    const total = samples.reduce((n, s) => n + s.length, 0);
    return `mock-voice-${total}`;
  }

  async synthesize(voiceRef: string | null, text: string): Promise<{ audio: Buffer; mime: string }> {
    const rate = 16000;
    const syllables = Math.max(1, Math.ceil([...text].length / 3));
    const seconds = Math.min(30, syllables * 0.18);
    const n = Math.floor(rate * seconds);
    const pitch = voiceRef ? 140 : 180;
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const envelope = Math.max(0, Math.sin(Math.PI * ((t / 0.18) % 1))); // one "syllable" every 180ms
      const sample = Math.sin(2 * Math.PI * pitch * t) * envelope * 0.35;
      pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return { audio: Buffer.concat([header, pcm]), mime: "audio/wav" };
  }

  async deleteVoice(): Promise<void> {}
}
