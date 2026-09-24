// A two-sided chess clock with Fischer increment. Time is measured with a
// monotonic clock, and the display ticks on an interval only for redraws.

const monotonic = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const TIME_CONTROLS = [
  { id: 'none', label: 'No clock', initial: 0, increment: 0 },
  { id: '1+0', label: 'Bullet 1+0', initial: 60, increment: 0 },
  { id: '2+1', label: 'Bullet 2+1', initial: 120, increment: 1 },
  { id: '3+0', label: 'Blitz 3+0', initial: 180, increment: 0 },
  { id: '3+2', label: 'Blitz 3+2', initial: 180, increment: 2 },
  { id: '5+0', label: 'Blitz 5+0', initial: 300, increment: 0 },
  { id: '5+3', label: 'Blitz 5+3', initial: 300, increment: 3 },
  { id: '10+0', label: 'Rapid 10+0', initial: 600, increment: 0 },
  { id: '10+5', label: 'Rapid 10+5', initial: 600, increment: 5 },
  { id: '15+10', label: 'Rapid 15+10', initial: 900, increment: 10 },
  { id: '30+0', label: 'Classical 30+0', initial: 1800, increment: 0 },
  { id: '30+20', label: 'Classical 30+20', initial: 1800, increment: 20 },
];

export function formatClockTime(ms) {
  const clamped = Math.max(0, ms);
  if (clamped < 20000) {
    // Tenths of a second in the danger zone.
    const tenths = Math.floor(clamped / 100);
    const s = Math.floor(tenths / 10);
    return `0:${String(s).padStart(2, '0')}.${tenths % 10}`;
  }
  const total = Math.ceil(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class ChessClock {
  constructor({ initialMs, incrementMs = 0, onTick = null, onFlag = null, onLowTime = null }) {
    this.initialMs = initialMs;
    this.incrementMs = incrementMs;
    this.times = { w: initialMs, b: initialMs };
    this.running = null;
    this.startedAt = 0;
    this.onTick = onTick;
    this.onFlag = onFlag;
    this.onLowTime = onLowTime;
    this.lowWarned = { w: false, b: false };
    this.flagged = null;
    this.timer = null;
  }

  // Current time for a side, including the time elapsed on the running clock.
  get(color) {
    if (this.running === color) return Math.max(0, this.times[color] - (monotonic() - this.startedAt));
    return this.times[color];
  }

  set(color, ms) {
    if (this.running === color) this.startedAt = monotonic();
    this.times[color] = ms;
    this.emit();
  }

  start(color) {
    if (this.flagged) return;
    this.stop();
    this.running = color;
    this.startedAt = monotonic();
    this.timer = setInterval(() => this.tick(), 100);
    this.emit();
  }

  stop() {
    if (this.running) {
      this.times[this.running] = this.get(this.running);
      this.running = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit();
  }

  // The player `color` finished a move: bank their increment and start the other side.
  press(color) {
    if (this.flagged) return;
    const wasRunning = this.running === color;
    this.stop();
    if (wasRunning) this.times[color] += this.incrementMs;
    this.start(color === 'w' ? 'b' : 'w');
  }

  tick() {
    const color = this.running;
    if (!color) return;
    const left = this.get(color);
    if (left <= 0) {
      this.times[color] = 0;
      this.flagged = color;
      this.stop();
      if (this.onFlag) this.onFlag(color);
      return;
    }
    const threshold = Math.min(10000, this.initialMs * 0.1);
    if (!this.lowWarned[color] && left <= threshold) {
      this.lowWarned[color] = true;
      if (this.onLowTime) this.onLowTime(color);
    }
    this.emit();
  }

  emit() {
    if (this.onTick) this.onTick({ w: this.get('w'), b: this.get('b'), running: this.running });
  }

  destroy() {
    this.stop();
    this.onTick = null;
    this.onFlag = null;
  }

  snapshot() {
    return { w: this.get('w'), b: this.get('b'), initialMs: this.initialMs, incrementMs: this.incrementMs };
  }
}
