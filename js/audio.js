// Cinematic score, generated live with the Web Audio API.
//
// Six layers stacked the way an orchestral cue is built:
//   sub      - felt more than heard, the floor of the piece
//   organ    - a drawbar-style harmonic stack, the spine
//   strings   - detuned saws with slow bows and vibrato
//   choir    - saws shaped by vowel formant filters
//   shimmer  - high bell tones two octaves up, drenched in reverb
//   riser    - filtered noise that lifts into a chord change
//
// A single `intensity` value (0..1) opens and closes these layers, so the
// intro cinematic can crescendo into the reveal and settle afterwards.
// Nothing is sampled: every visit is a slightly different performance.

// i - VI - III - VII in D minor, with a lift at the end of the cycle.
// Each entry is [root, third, fifth] in Hz, plus a weight for the drum hit.
const PROGRESSION = [
  { name: 'Dm', tones: [73.416, 87.307, 110.000], accent: 1.0 },
  { name: 'Bb', tones: [58.270, 73.416, 87.307], accent: 0.6 },
  { name: 'F',  tones: [87.307, 110.000, 130.813], accent: 0.7 },
  { name: 'C',  tones: [65.406, 82.407, 98.000], accent: 0.6 },
  { name: 'Dm', tones: [73.416, 87.307, 110.000], accent: 1.0 },
  { name: 'Bb', tones: [58.270, 73.416, 87.307], accent: 0.6 },
  { name: 'Gm', tones: [48.999, 58.270, 73.416], accent: 0.8 },
  { name: 'A',  tones: [55.000, 69.296, 82.407], accent: 0.9 },
];

// Drawbar registration: harmonic number -> relative level.
const ORGAN_PARTIALS = [[1, 1.0], [2, 0.52], [3, 0.30], [4, 0.22], [6, 0.11], [8, 0.07]];
// "Ah" vowel formants: [frequency, Q, gain]
const FORMANTS = [[800, 9, 1.0], [1150, 11, 0.7], [2900, 13, 0.32]];

const CHORD_SECONDS = 13.5;   // one chord
const CROSSFADE = 5.5;        // overlap between chords

export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.volume = 0.55;
    this.intensity = 0.4;
    this._timers = [];
    this._stops = [];
    this._chordIndex = 0;
  }

  // ---------------------------------------------------------------- lifecycle
  async start() {
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.playing) return;
    this.playing = true;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0.0001, t);
    this.master.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volume), t + 6);
    this._chordIndex = 0;
    this._nextChord();
  }

  stop() {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    this._timers.forEach(clearTimeout);
    this._timers = [];
    setTimeout(() => { if (!this.playing) this._killVoices(); }, 3200);
  }

  toggle() { this.playing ? this.stop() : this.start(); return this.playing; }

  setVolume(v) {
    this.volume = v;
    if (this.ctx && this.playing) this.master.gain.setTargetAtTime(Math.max(0.0001, v), this.ctx.currentTime, 0.15);
  }

  /** Open or close the arrangement. 0 = sparse and distant, 1 = full and close. */
  setIntensity(v, seconds = 8) {
    this.intensity = Math.max(0, Math.min(1, v));
    if (!this.ctx) return;
    const t = this.ctx.currentTime, i = this.intensity;
    const ramp = (param, value) => {
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(value, t + seconds);
    };
    ramp(this.bus.organ.gain, 0.20 + 0.55 * i);
    ramp(this.bus.strings.gain, Math.max(0, i - 0.12) * 0.85);
    ramp(this.bus.choir.gain, Math.pow(Math.max(0, i - 0.30) / 0.7, 1.4) * 0.75);
    ramp(this.bus.shimmer.gain, 0.25 + 0.75 * i);
    ramp(this.bus.sub.gain, 0.45 + 0.55 * i);
    ramp(this.tone.frequency, 620 + 3600 * Math.pow(i, 0.75));
  }

  // ------------------------------------------------------------------- graph
  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 24; comp.ratio.value = 3.5;
    comp.attack.value = 0.06; comp.release.value = 0.9;
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    // Big hall: long, dark, slow-building tail.
    const hall = ctx.createConvolver();
    hall.buffer = this._impulse(8.5, 2.6, 0.12);
    const hallWet = ctx.createGain(); hallWet.gain.value = 0.85;
    hall.connect(hallWet); hallWet.connect(comp);

    const dry = ctx.createGain(); dry.gain.value = 0.62;
    dry.connect(comp);

    // Everything tonal passes through one slow tone filter, opened by intensity.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1400;
    this.tone.Q.value = 0.5;
    this.tone.connect(dry); this.tone.connect(hall);

    // A gentle drift so the timbre is never static.
    const drift = ctx.createOscillator(); drift.frequency.value = 0.021;
    const driftAmt = ctx.createGain(); driftAmt.gain.value = 420;
    drift.connect(driftAmt); driftAmt.connect(this.tone.frequency); drift.start();
    this._track(drift);

    // Per-layer busses so intensity can open them independently.
    const mk = (gain, dest) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(dest); return g; };
    this.bus = {
      sub: mk(0.7, dry),              // sub skips the reverb so it stays tight
      organ: mk(0.45, this.tone),
      strings: mk(0.4, this.tone),
      choir: mk(0.3, this.tone),
      shimmer: mk(0.5, hall),         // shimmer is pure reverb
      drum: mk(0.9, dry),
    };
    this.bus.shimmerDry = mk(0.18, dry);
  }

  _impulse(seconds, decay, predelay = 0) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const pre = Math.floor(rate * predelay);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = pre; i < len; i++) {
        const x = (i - pre) / (len - pre);
        // slight build then long decay reads as a large hall rather than a room
        const env = Math.pow(1 - x, decay) * Math.min(1, x * 14);
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  /** Keep a handle on a source only until it finishes, so long sessions do not accumulate nodes. */
  _track(node) {
    this._stops.push(node);
    node.onended = () => { this._stops = this._stops.filter(x => x !== node); };
    return node;
  }

  _pan(value) {
    if (!this.ctx.createStereoPanner) return null;
    const p = this.ctx.createStereoPanner(); p.pan.value = value; return p;
  }

  // ------------------------------------------------------------------ voices
  /** Shared slow swell envelope. */
  _env(peak, attack, hold, release) {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    const total = attack + hold + release;
    this._timers.push(setTimeout(() => { try { g.disconnect(); } catch (e) {} }, (total + 0.6) * 1000));
    return { g, total };
  }

  _osc(type, freq, detune, dest, gain, total) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain(); g.gain.value = gain;
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + total + 0.2);
    this._track(o);
    return o;
  }

  _sub(root, dur) {
    const { g, total } = this._env(0.32, 5, dur - 8, 7);
    g.connect(this.bus.sub);
    this._osc('sine', root / 2, 0, g, 1.0, total);
    this._osc('sine', root, 0, g, 0.35, total);
  }

  _organ(tones, dur) {
    for (let ti = 0; ti < tones.length; ti++) {
      const f = tones[ti];
      const { g, total } = this._env(ti === 0 ? 0.13 : 0.085, 4.5, dur - 9, 7.5);
      const pan = this._pan((ti - 1) * 0.28);
      if (pan) { g.connect(pan); pan.connect(this.bus.organ); } else g.connect(this.bus.organ);
      for (const [harmonic, level] of ORGAN_PARTIALS) {
        // the octave above the root carries the "cathedral" weight
        this._osc('sine', f * harmonic, (Math.random() - 0.5) * 6, g, level, total);
      }
      this._osc('sine', f * 2, 3, g, 0.4, total);
    }
  }

  _strings(tones, dur) {
    const ctx = this.ctx;
    for (let ti = 0; ti < tones.length; ti++) {
      const f = tones[ti] * 2; // strings sit an octave above the organ
      const { g, total } = this._env(0.055, 7, dur - 12, 8);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.7;
      const pan = this._pan((Math.random() - 0.5) * 0.9);
      g.connect(lp);
      if (pan) { lp.connect(pan); pan.connect(this.bus.strings); } else lp.connect(this.bus.strings);
      // three players, never quite in tune with each other
      for (const cents of [-7, 0, 9]) {
        const o = this._osc('sawtooth', f, cents + (Math.random() - 0.5) * 5, g, 0.33, total);
        const vib = ctx.createOscillator(); vib.frequency.value = 4.4 + Math.random() * 1.4;
        const vibAmt = ctx.createGain(); vibAmt.gain.value = 4 + Math.random() * 3;
        vib.connect(vibAmt); vibAmt.connect(o.detune); vib.start();
        vib.stop(ctx.currentTime + total + 0.2);
        this._track(vib);
      }
    }
  }

  _choir(tones, dur) {
    const ctx = this.ctx;
    for (let ti = 0; ti < tones.length; ti++) {
      const f = tones[ti] * 4; // voices sing high above the bass
      const { g, total } = this._env(0.05, 8, dur - 13, 8);
      const pan = this._pan((ti - 1) * 0.5);
      const out = ctx.createGain(); out.gain.value = 1;
      if (pan) { out.connect(pan); pan.connect(this.bus.choir); } else out.connect(this.bus.choir);
      // one source, three formant bands -> a vowel rather than a buzz
      for (const [freq, q, level] of FORMANTS) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
        const lg = ctx.createGain(); lg.gain.value = level;
        g.connect(bp); bp.connect(lg); lg.connect(out);
      }
      for (const cents of [-6, 5]) this._osc('sawtooth', f, cents, g, 0.5, total);
      // breath: the vowel opens slightly as the note blooms
      const shift = ctx.createOscillator(); shift.frequency.value = 0.07;
      const shiftAmt = ctx.createGain(); shiftAmt.gain.value = 55;
      shift.connect(shiftAmt); shift.start(); shift.stop(ctx.currentTime + total + 0.2);
      this._track(shift);
    }
  }

  _shimmer(tones, dur) {
    // Bell tones drifting two octaves above the chord, scattered through the bar.
    const count = 3 + Math.round(this.intensity * 4);
    for (let i = 0; i < count; i++) {
      const delay = Math.random() * (dur - 6);
      this._timers.push(setTimeout(() => {
        if (!this.playing) return;
        const f = tones[Math.floor(Math.random() * tones.length)] * (Math.random() < 0.45 ? 8 : 4);
        const { g, total } = this._env(0.06 + Math.random() * 0.05, 1.6, 0.4, 5 + Math.random() * 4);
        const pan = this._pan((Math.random() - 0.5) * 1.5);
        if (pan) { g.connect(pan); pan.connect(this.bus.shimmer); pan.connect(this.bus.shimmerDry); }
        else { g.connect(this.bus.shimmer); g.connect(this.bus.shimmerDry); }
        this._osc('sine', f, 0, g, 1.0, total);
        this._osc('sine', f * 2.004, 0, g, 0.18, total);
      }, delay * 1000));
    }
  }

  _drum(accent) {
    const ctx = this.ctx, t = ctx.currentTime;
    const level = 0.22 * accent * Math.pow(this.intensity, 1.3);
    if (level < 0.012) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    g.connect(this.bus.drum);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(92, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 1.1);
    o.connect(g); o.start(t); o.stop(t + 2.7);
    this._track(o);
  }

  _riser(dur) {
    // Noise that lifts into the next chord. Only once the piece has opened up.
    if (this.intensity < 0.45) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const len = Math.min(dur, 7);
    const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035 * this.intensity, t + len * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(bp); bp.connect(g); g.connect(this.bus.strings);
    src.start(t); src.stop(t + len + 0.1);
    this._track(src);
  }

  // ------------------------------------------------------------------ driver
  _nextChord() {
    if (!this.playing) return;
    const chord = PROGRESSION[this._chordIndex % PROGRESSION.length];
    const dur = CHORD_SECONDS + Math.random() * 2;

    this._sub(chord.tones[0], dur);
    this._organ(chord.tones, dur);
    this._drum(chord.accent);
    if (this.intensity > 0.12) this._strings(chord.tones, dur);
    if (this.intensity > 0.30) this._choir(chord.tones, dur);
    this._shimmer(chord.tones, dur);

    const next = dur - CROSSFADE;
    // the riser arrives just before the next chord lands
    this._timers.push(setTimeout(() => { if (this.playing) this._riser(CROSSFADE); }, Math.max(0, (next - 4)) * 1000));
    this._chordIndex++;
    this._timers.push(setTimeout(() => this._nextChord(), next * 1000));
  }

  _killVoices() {
    this._stops.forEach(o => { try { o.stop(); } catch (e) {} });
    this._stops = [];
  }

  /** Soft mallet note when a world is selected; tuned to the current key. */
  chime(freq = 587.33) {
    if (!this.ctx || !this.playing) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    g.connect(this.bus.shimmer); g.connect(this.bus.shimmerDry);
    for (const [mult, level] of [[1, 1], [2.01, 0.3], [3.01, 0.12]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult;
      const og = ctx.createGain(); og.gain.value = level;
      o.connect(og); og.connect(g); o.start(t); o.stop(t + 3.3);
      this._track(o);
    }
  }
}

// D minor scale degrees, so selection chimes always land in key.
export const CHIME_SCALE = [587.33, 659.26, 698.46, 783.99, 880.00, 932.33, 1046.50, 1174.66];
