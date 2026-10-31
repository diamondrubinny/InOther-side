/**
 * Plays speech clips in order and exposes the current loudness (0..1), which drives the
 * avatar's mouth. Uses one <audio> element routed through a Web Audio AnalyserNode.
 */
export class SpeechPlayer {
  private readonly audio = new Audio();
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private queue: { load: () => Promise<Blob>; onStart?: () => void }[] = [];
  private playing = false;
  private currentUrl: string | null = null;
  muted = false;

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const source = this.ctx.createMediaElementSource(this.audio);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  enqueue(load: () => Promise<Blob>, onStart?: () => void): void {
    this.queue.push({ load, onStart });
    if (!this.playing) void this.next();
  }

  private async next(): Promise<void> {
    const item = this.queue.shift();
    if (!item) {
      this.playing = false;
      return;
    }
    this.playing = true;
    try {
      const blob = await item.load();
      if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = URL.createObjectURL(blob);
      this.audio.src = this.currentUrl;
      this.audio.muted = this.muted;
      item.onStart?.();
      await this.ctx?.resume();
      await this.audio.play();
      await new Promise<void>((resolve) => {
        this.audio.onended = () => resolve();
        this.audio.onerror = () => resolve();
      });
    } catch {
      /* skip a clip that fails to load/play */
    }
    void this.next();
  }

  /** Current loudness, smoothed to 0..1. */
  level(): number {
    if (!this.analyser || !this.data || this.audio.paused) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (const v of this.data) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.data.length) * 4);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.audio.muted = muted;
  }

  stop(): void {
    this.queue = [];
    this.audio.pause();
    this.playing = false;
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
