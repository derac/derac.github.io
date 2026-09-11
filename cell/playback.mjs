// Elapsed-time pacing changes how often the model advances, never its equations.
export const MIN_SPEED = 1;
export const MAX_SPEED = 2000;
export const sliderToSpeed = value => Math.round(Math.exp(Math.max(0, Math.min(1000, value)) / 1000 * Math.log(MAX_SPEED)));
export const speedToSlider = speed => Math.round(Math.log(speed) / Math.log(MAX_SPEED) * 1000);

export class PlaybackClock {
  constructor(rate = 120) { this.setRate(rate); }
  setRate(rate) {
    if (!Number.isInteger(rate) || rate < MIN_SPEED || rate > MAX_SPEED) throw Error('Playback speed must be 1–2000 steps per second.');
    this.rate = rate; this.reset();
  }
  reset() { this.last = null; this.credit = 0; }
  advance(now, active) {
    const elapsed = this.last === null ? 0 : Math.max(0, now - this.last) / 1000;
    this.last = now;
    if (!active) { this.credit = 0; return; }
    // Retain fractions for slow playback, but discard long stalls and excess backlog.
    this.credit = Math.min(this.credit + Math.min(elapsed, 0.1) * this.rate, Math.max(1, this.rate * 0.1));
  }
  take(limit) {
    const count = Math.min(Math.floor(this.credit + 1e-9), limit);
    this.credit = Math.max(0, this.credit - count); return count;
  }
}
