export class RhythmClock {
  constructor(bpm = 120) {
    this.bpm = bpm;
    this.position = 0;
    this.startedAt = 0;
    this.running = false;
    this.audio = null;
  }

  attachAudio(audio) {
    this.audio = audio;
    if (audio) this.seek(this.position);
  }

  get current() {
    if (this.audio && Number.isFinite(this.audio.currentTime)) {
      return this.audio.currentTime * 1000;
    }
    return this.running ? performance.now() - this.startedAt : this.position;
  }

  async start() {
    if (this.running) return;
    this.startedAt = performance.now() - this.position;
    this.running = true;
    if (this.audio) {
      this.audio.currentTime = Math.max(0, this.position / 1000);
      try { await this.audio.play(); } catch (_) {}
    }
  }

  pause() {
    if (!this.running) return;
    this.position = this.current;
    this.running = false;
    if (this.audio) this.audio.pause();
  }

  seek(ms) {
    this.position = Math.max(0, Number(ms) || 0);
    if (this.running) this.startedAt = performance.now() - this.position;
    if (this.audio && Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.min(this.position / 1000, this.audio.duration || Infinity);
    }
  }

  get beatMs() { return 60000 / this.bpm; }
}
