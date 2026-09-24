// Sound effects synthesised with the Web Audio API, so the game ships with
// no audio files. Each effect is a short envelope over noise or tones that
// imitates a wooden piece on a board.

export class SoundBoard {
  constructor() {
    this.enabled = true;
    this.volume = 0.6;
    this.ctx = null;
    this.noiseBuffer = null;
  }

  // Browsers only allow audio after a user gesture; call this from one.
  unlock() {
    if (!this.ctx) {
      const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AudioCtx) return;
      try {
        this.ctx = new AudioCtx();
      } catch {
        this.ctx = null;
        return;
      }
      const length = Math.floor(this.ctx.sampleRate * 0.25);
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  master(gain) {
    const g = this.ctx.createGain();
    g.gain.value = gain * this.volume;
    g.connect(this.ctx.destination);
    return g;
  }

  // A filtered noise burst: the "knock" of wood on wood.
  knock({ at = 0, freq = 1800, q = 1.2, duration = 0.07, gain = 0.9 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(env).connect(this.master(gain));
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  tone({ at = 0, freq = 440, duration = 0.2, gain = 0.25, type = 'sine', slide = 0 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(this.master(gain));
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  play(name) {
    if (!this.ready()) return;
    switch (name) {
      case 'move':
        this.knock({ freq: 1500, duration: 0.06 });
        this.knock({ at: 0.004, freq: 420, q: 2, duration: 0.05, gain: 0.5 });
        break;
      case 'capture':
        this.knock({ freq: 900, duration: 0.09, gain: 1 });
        this.knock({ at: 0.03, freq: 2200, duration: 0.05, gain: 0.6 });
        this.knock({ at: 0.004, freq: 260, q: 2.5, duration: 0.08, gain: 0.6 });
        break;
      case 'castle':
        this.knock({ freq: 1500, duration: 0.05 });
        this.knock({ at: 0.11, freq: 1300, duration: 0.06 });
        break;
      case 'check':
        this.knock({ freq: 1500, duration: 0.06 });
        this.tone({ at: 0.02, freq: 880, duration: 0.16, gain: 0.12, type: 'triangle' });
        this.tone({ at: 0.1, freq: 1175, duration: 0.2, gain: 0.1, type: 'triangle' });
        break;
      case 'promote':
        this.knock({ freq: 1500, duration: 0.06 });
        this.tone({ at: 0.03, freq: 660, duration: 0.25, gain: 0.12, type: 'triangle', slide: 1.5 });
        break;
      case 'illegal':
        this.tone({ freq: 180, duration: 0.12, gain: 0.12, type: 'square' });
        break;
      case 'start':
        this.tone({ freq: 523, duration: 0.18, gain: 0.1, type: 'triangle' });
        this.tone({ at: 0.09, freq: 784, duration: 0.3, gain: 0.1, type: 'triangle' });
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ at: i * 0.09, freq: f, duration: 0.35, gain: 0.1, type: 'triangle' }));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => this.tone({ at: i * 0.14, freq: f, duration: 0.4, gain: 0.1, type: 'sine' }));
        break;
      case 'draw':
        this.tone({ freq: 440, duration: 0.3, gain: 0.1, type: 'triangle' });
        this.tone({ at: 0.15, freq: 440, duration: 0.35, gain: 0.08, type: 'triangle' });
        break;
      case 'lowtime':
        this.tone({ freq: 1320, duration: 0.07, gain: 0.08, type: 'square' });
        this.tone({ at: 0.12, freq: 1320, duration: 0.07, gain: 0.08, type: 'square' });
        break;
      case 'notify':
        this.tone({ freq: 988, duration: 0.12, gain: 0.08, type: 'sine' });
        break;
      default:
        break;
    }
  }
}
