// Generative ambient soundtrack, composed live with the Web Audio API.
// No audio files: slow chord drones, a shimmering pentatonic melody, a sub bass,
// and a synthesized hall reverb. Each visit is a slightly different piece.

const CHORDS = [
  // Root frequencies (Hz) for slowly cycling chords, mostly open/suspended voicings.
  [55.00, 82.41, 110.00, 164.81, 220.00, 329.63],   // A  – A E A E A E
  [65.41, 98.00, 130.81, 196.00, 261.63, 392.00],   // C  – C G C G C G
  [73.42, 110.00, 146.83, 220.00, 293.66, 440.00],  // D  – D A D A D A
  [49.00, 73.42,  98.00, 146.83, 196.00, 293.66],   // G  – G D G D G D
  [58.27, 87.31, 116.54, 174.61, 233.08, 349.23],   // Bb – Bb F Bb F Bb F
  [43.65, 65.41,  87.31, 130.81, 174.61, 261.63],   // F  – F C F C F C
];
const PENTA = [440.00, 493.88, 554.37, 659.26, 739.99, 880.00, 987.77, 1108.73, 1318.51];

export class Soundtrack {
  constructor() {
    this.ctx = null; this.master = null; this.playing = false; this.volume = 0.5;
    this._timers = []; this._voices = [];
  }
  async start() {
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.playing) return;
    this.playing = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.master.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volume), this.ctx.currentTime + 4);
    this._chordIndex = 0;
    this._nextChord();
    this._melodyLoop();
  }
  stop() {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    this._timers.forEach(clearTimeout); this._timers = [];
    setTimeout(() => { if (!this.playing) this._killVoices(); }, 2600);
  }
  toggle() { this.playing ? this.stop() : this.start(); return this.playing; }
  setVolume(v) {
    this.volume = v;
    if (this.ctx && this.playing) this.master.gain.setTargetAtTime(Math.max(0.0001, v), this.ctx.currentTime, 0.1);
  }
  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.0001;
    // gentle master compression so swells never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.6;
    // reverb: synthesized impulse response (exponentially decaying noise, 6 s)
    const convolver = ctx.createConvolver();
    convolver.buffer = this._impulse(6, 3.2);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    const dry = ctx.createGain(); dry.gain.value = 0.7;
    this.bus = ctx.createGain();
    this.bus.connect(dry); this.bus.connect(convolver); convolver.connect(wet);
    dry.connect(comp); wet.connect(comp); comp.connect(this.master); this.master.connect(ctx.destination);
    // slow filter sweep over the whole bus for movement
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 1400; this.filter.Q.value = 0.4;
    this.filter.connect(this.bus);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.023;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 500;
    lfo.connect(lfoGain); lfoGain.connect(this.filter.frequency); lfo.start();
  }
  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate, len = rate * seconds, buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  _pad(freq, duration, gainPeak, detune = 0) {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gainPeak, t + duration * 0.35);
    g.gain.setValueAtTime(gainPeak, t + duration * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const oscs = [];
    for (const [type, det, amt] of [['sine', 0, 1], ['triangle', 6 + detune, 0.35], ['sawtooth', -5 - detune, 0.08]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = amt;
      o.connect(og); og.connect(g); o.start(t); o.stop(t + duration + 0.1); oscs.push(o);
    }
    g.connect(this.filter);
    this._voices.push({ g, oscs });
    setTimeout(() => { this._voices = this._voices.filter(v => v.g !== g); }, (duration + 0.5) * 1000);
  }
  _nextChord() {
    if (!this.playing) return;
    const chord = CHORDS[this._chordIndex % CHORDS.length];
    const dur = 22 + Math.random() * 8;
    chord.forEach((f, i) => {
      const gain = i === 0 ? 0.16 : i < 3 ? 0.09 : 0.045;
      this._pad(f, dur, gain, Math.random() * 6);
    });
    // Walk the chord cycle with occasional jumps so it never repeats exactly.
    this._chordIndex += Math.random() < 0.75 ? 1 : 2 + Math.floor(Math.random() * 2);
    this._timers.push(setTimeout(() => this._nextChord(), (dur * 0.62) * 1000));
  }
  _melodyLoop() {
    if (!this.playing) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (Math.random() < 0.7) {
      const f = PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.3 ? 2 : 1);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.001;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      const peak = 0.05 + Math.random() * 0.05, dur = 4 + Math.random() * 5;
      g.gain.exponentialRampToValueAtTime(peak, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.random() * 1.4 - 0.7; }
      o.connect(g); o2.connect(g2); g2.connect(g);
      if (pan) { g.connect(pan); pan.connect(this.bus); } else g.connect(this.bus);
      o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    }
    this._timers.push(setTimeout(() => this._melodyLoop(), (3 + Math.random() * 7) * 1000));
  }
  _killVoices() {
    this._voices.forEach(v => v.oscs.forEach(o => { try { o.stop(); } catch (e) {} }));
    this._voices = [];
  }
  // Short synthesized "chime" when a world is selected.
  chime(freq = 880) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 2.5);
  }
}
