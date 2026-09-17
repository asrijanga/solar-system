// Lofi soundtrack, generated live with the Web Audio API.
//
// A slow boom-bap beat under a Rhodes electric piano, the way a late-night
// study stream sounds. Nothing is sampled; every part is synthesised:
//
//   rhodes  - FM electric piano, a sine carrier bent by a sine modulator whose
//             index decays fast, which is what gives a Rhodes its bell attack
//   bass    - round triangle upright, roots and passing notes
//   drums   - synthesised kick, dusty snare and closed hats, played with swing
//   pad     - a soft filtered bed that opens up underneath
//   vinyl   - looping crackle and hiss, always present
//   tape    - wow and flutter from a delay line whose time is modulated, so the
//             whole thing drifts slightly out of tune like a worn cassette
//
// Timing uses the standard lookahead pattern: a coarse timer wakes up often and
// schedules notes slightly ahead on the audio clock, so nothing is at the mercy
// of setTimeout jitter.
//
// A single `intensity` value (0..1) arranges the track. Low is just keys, bass
// and crackle; the drums walk in around a third of the way up; the top is the
// full kit. The opening cinematic drives it, so the beat drops in as the camera
// pulls away from Earth.

const midi = m => 440 * Math.pow(2, (m - 69) / 12);

// I - vi - ii - V twice through, the standard lofi turnaround, with seventh and
// ninth voicings. `bass` is the root; `voicing` is the right hand.
const PROGRESSION = [
  { name: 'Fmaj7', bass: 41, voicing: [53, 57, 60, 64, 67] },
  { name: 'Em7',   bass: 40, voicing: [52, 55, 59, 62] },
  { name: 'Dm9',   bass: 38, voicing: [50, 53, 57, 60, 64] },
  { name: 'G7',    bass: 43, voicing: [50, 55, 59, 65] },
  { name: 'Cmaj9', bass: 36, voicing: [52, 55, 59, 62, 64] },
  { name: 'Am7',   bass: 33, voicing: [48, 52, 55, 60] },
  { name: 'Dm7',   bass: 38, voicing: [50, 53, 57, 60] },
  { name: 'G13',   bass: 43, voicing: [53, 57, 59, 64] },
];

// C major pentatonic, for the sparse lead phrases and the selection chime.
const LEAD_NOTES = [72, 74, 76, 79, 81, 84, 86];

const BPM = 74;
const STEPS_PER_BAR = 16;          // sixteenth notes
const SWING = 0.30;                // how far the offbeat eighth is pushed, in sixteenths

// Step positions within a bar.
const KICK = [0, 10];
const SNARE = [4, 12];
const HAT = [0, 2, 4, 6, 8, 10, 12, 14];

export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.volume = 0.55;
    this.intensity = 0.4;
    this._stops = [];
    this._timer = null;
    this._step = 0;
    this._nextTime = 0;
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
    this.master.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volume), t + 4);

    this._vinyl.start();
    this._step = 0;
    this._nextTime = t + 0.35;
    this._lookahead = 0.35;
    this._lastSchedule = 0;
    this.setIntensity(this.intensity, 0.1);
    this._schedule();
    this._timer = setInterval(() => this._schedule(), 60);
  }

  stop() {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    clearInterval(this._timer); this._timer = null;
    setTimeout(() => { if (!this.playing) { this._vinyl.stop(); this._killVoices(); } }, 2400);
  }

  toggle() { this.playing ? this.stop() : this.start(); return this.playing; }

  setVolume(v) {
    this.volume = v;
    if (this.ctx && this.playing) this.master.gain.setTargetAtTime(Math.max(0.0001, v), this.ctx.currentTime, 0.15);
  }

  /** Arrange the track. 0 = keys and crackle only, 1 = the full kit. */
  setIntensity(v, seconds = 8) {
    this.intensity = Math.max(0, Math.min(1, v));
    if (!this.ctx) return;
    const t = this.ctx.currentTime, i = this.intensity;
    const ramp = (param, value) => {
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(value, t + seconds);
    };
    // the beat fades in over the lower third rather than switching on
    const beat = Math.max(0, Math.min(1, (i - 0.30) / 0.30));
    ramp(this.bus.drums.gain, beat * 1.0);
    ramp(this.bus.rhodes.gain, 1.30 + 0.55 * i);
    ramp(this.bus.bass.gain, 0.30 + 0.28 * i);
    ramp(this.bus.pad.gain, 0.08 + 0.30 * i);
    ramp(this.tone.frequency, 1900 + 4200 * Math.pow(i, 0.7));
    this._beatMix = beat;
  }

  // ------------------------------------------------------------------- graph
  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(ctx.destination);

    // Glue compression, then a little tape saturation to round the peaks off.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 3;
    comp.attack.value = 0.012; comp.release.value = 0.22;

    const sat = ctx.createWaveShaper();
    sat.curve = this._saturation(1.9);
    sat.oversample = '2x';
    comp.connect(sat); sat.connect(this.master);

    // Lofi means band limited: roll the top off and clear the sub mud.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass'; this.tone.frequency.value = 3600; this.tone.Q.value = 0.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 46;
    this.tone.connect(hp); hp.connect(comp);

    // Small warm room. Nothing like the cathedral the old score used.
    const room = ctx.createConvolver();
    room.buffer = this._impulse(1.9, 3.2);
    const roomWet = ctx.createGain(); roomWet.gain.value = 0.32;
    room.connect(roomWet); roomWet.connect(this.tone);
    this._room = room;

    // Tape wow and flutter: a short delay whose time wanders, so pitch drifts.
    const wobble = ctx.createDelay(0.1);
    wobble.delayTime.value = 0.011;
    const wow = ctx.createOscillator(); wow.frequency.value = 0.27;
    const wowAmt = ctx.createGain(); wowAmt.gain.value = 0.0032;
    wow.connect(wowAmt); wowAmt.connect(wobble.delayTime); wow.start(); this._track(wow);
    const flutter = ctx.createOscillator(); flutter.frequency.value = 6.1;
    const flutAmt = ctx.createGain(); flutAmt.gain.value = 0.00035;
    flutter.connect(flutAmt); flutAmt.connect(wobble.delayTime); flutter.start(); this._track(flutter);
    wobble.connect(this.tone);
    this._wobble = wobble;

    // The kick ducks the melodic side a touch, the way a lofi mix breathes.
    this.duck = ctx.createGain(); this.duck.gain.value = 1;
    this.duck.connect(wobble);

    const mk = (gain, dest) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(dest); return g; };
    this.bus = {
      rhodes: mk(1.5, this.duck),
      bass: mk(0.4, this.duck),      // bass is ducked too, but it skips the reverb below
      pad: mk(0.2, this.duck),
      drums: mk(0.0, this.tone),     // drums stay dry and out of the duck
      vinyl: mk(0.9, this.tone),
    };
    // send keys and pad to the room
    this.bus.rhodes.connect(room);
    this.bus.pad.connect(room);

    this._vinyl = this._makeVinyl();
  }

  _saturation(amount) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, decay);
      }
    }
    return buf;
  }

  /** Looping surface noise: steady hiss plus sparse decaying pops. */
  _makeVinyl() {
    const ctx = this.ctx, seconds = 4.5, rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.010;
      const pops = Math.floor(seconds * 34);
      for (let k = 0; k < pops; k++) {
        const at = Math.floor(Math.random() * (len - 400));
        const amp = 0.04 + Math.pow(Math.random(), 2) * 0.5;
        const dur = 25 + Math.floor(Math.random() * 130);
        for (let j = 0; j < dur; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.pow(1 - j / dur, 3);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1100;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7200;
    const g = ctx.createGain(); g.gain.value = 0.5;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.bus.vinyl);
    let started = false;
    return {
      start: () => { if (!started) { src.start(); started = true; } },
      stop: () => { try { src.stop(); } catch (e) {} },
    };
  }

  _track(node) {
    this._stops.push(node);
    node.onended = () => { this._stops = this._stops.filter(x => x !== node); };
    return node;
  }

  _pan(v) {
    if (!this.ctx.createStereoPanner) return null;
    const p = this.ctx.createStereoPanner(); p.pan.value = v; return p;
  }

  // ------------------------------------------------------------------ voices
  /**
   * FM electric piano. The modulator runs at the carrier frequency and its index
   * collapses within a few hundred milliseconds, which is what makes a Rhodes
   * chime on the attack and turn to a soft sine as it rings out.
   */
  _rhodes(note, time, dur, velocity, pan = 0, bus = null) {
    const ctx = this.ctx, f = midi(note);
    const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 2;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * (1.4 + velocity * 1.9), time);
    modGain.gain.exponentialRampToValueAtTime(f * 0.04, time + 0.28);
    mod.connect(modGain); modGain.connect(carrier.frequency);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(velocity, time + 0.011);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.30, time + 0.45);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    carrier.connect(amp);

    const p = this._pan(pan);
    const dest = bus || this.bus.rhodes;
    if (p) { amp.connect(p); p.connect(dest); } else amp.connect(dest);

    carrier.start(time); carrier.stop(time + dur + 0.1);
    mod.start(time); mod.stop(time + dur + 0.1);
    this._track(carrier); this._track(mod);
  }

  _bass(note, time, dur, velocity) {
    const ctx = this.ctx, f = midi(note);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f / 2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 760; lp.Q.value = 1.0;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(velocity, time + 0.05);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.5, time + dur * 0.6);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const sub = ctx.createGain(); sub.gain.value = 0.30;
    o.connect(lp); o2.connect(sub); sub.connect(lp); lp.connect(amp); amp.connect(this.bus.bass);
    o.start(time); o.stop(time + dur + 0.1); o2.start(time); o2.stop(time + dur + 0.1);
    this._track(o); this._track(o2);
  }

  _pad(notes, time, dur) {
    const ctx = this.ctx;
    for (const n of notes) {
      const f = midi(n);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(0.024, time + dur * 0.4);
      amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 0.6;
      const p = this._pan((Math.random() - 0.5) * 1.2);
      for (const cents of [-8, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents;
        o.connect(lp); o.start(time); o.stop(time + dur + 0.1); this._track(o);
      }
      lp.connect(amp);
      if (p) { amp.connect(p); p.connect(this.bus.pad); } else amp.connect(this.bus.pad);
    }
  }

  _noise(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    return src;
  }

  _kick(time, velocity) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(124, time);
    o.frequency.exponentialRampToValueAtTime(43, time + 0.11);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocity, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
    o.connect(amp); amp.connect(this.bus.drums);
    o.start(time); o.stop(time + 0.45); this._track(o);

    // duck the keys so the kick has room
    const d = this.duck.gain;
    d.cancelScheduledValues(time);
    d.setValueAtTime(1, time);
    d.linearRampToValueAtTime(1 - 0.22 * this._beatMix, time + 0.02);
    d.linearRampToValueAtTime(1, time + 0.30);
  }

  _snare(time, velocity) {
    const ctx = this.ctx;
    const src = this._noise(0.25);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1750; bp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocity * 0.7, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    src.connect(bp); bp.connect(lp); lp.connect(amp);
    amp.connect(this.bus.drums); amp.connect(this._room);
    src.start(time); src.stop(time + 0.25); this._track(src);

    // a little body under the noise
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 188;
    const og = ctx.createGain();
    og.gain.setValueAtTime(velocity * 0.32, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    o.connect(og); og.connect(this.bus.drums);
    o.start(time); o.stop(time + 0.14); this._track(o);
  }

  _hat(time, velocity) {
    const ctx = this.ctx;
    const src = this._noise(0.09);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6800;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocity * 0.18, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    src.connect(hp); hp.connect(amp);
    const p = this._pan(0.15);
    if (p) { amp.connect(p); p.connect(this.bus.drums); } else amp.connect(this.bus.drums);
    src.start(time); src.stop(time + 0.09); this._track(src);
  }

  // ---------------------------------------------------------------- scheduler
  //
  // Lookahead scheduling: a coarse timer wakes up and commits notes onto the audio
  // clock a little way ahead, so the groove does not inherit setTimeout's jitter.
  //
  // The horizon has to be longer than the main thread can stall for. This page
  // renders a heavy WebGL scene, and on a slow GPU a single frame can block the
  // thread for longer than a fixed 0.3s horizon, at which point every missed step
  // gets committed at once and the beat collapses into mush. So the horizon tracks
  // the observed stall length, and anything that still slips into the past is
  // skipped rather than dumped on the downbeat.
  get _sixteenth() { return 60 / BPM / 4; }

  _schedule() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;

    if (this._lastSchedule) {
      const gap = now - this._lastSchedule;
      const want = Math.min(2.0, Math.max(0.35, gap * 3));
      // grow the horizon immediately when the thread stalls, relax it slowly after
      this._lookahead = Math.max(want, (this._lookahead || 0.35) * 0.95);
    }
    this._lastSchedule = now;

    // Realign if the grid has fallen behind: skip the missed steps instead of
    // scheduling them in the past, where they would all fire simultaneously.
    if (this._nextTime < now) {
      const missed = Math.ceil((now - this._nextTime) / this._sixteenth);
      this._step += missed;
      this._nextTime += missed * this._sixteenth;
    }

    const ahead = now + (this._lookahead || 0.35);
    while (this._nextTime < ahead) {
      this._scheduleStep(this._step, this._nextTime);
      this._step++;
      this._nextTime += this._sixteenth;
    }
  }

  _scheduleStep(step, time) {
    const inBar = step % STEPS_PER_BAR;
    const bar = Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length;
    const chord = PROGRESSION[bar];
    const i = this.intensity;
    const beat = this._beatMix ?? 0;
    // swing: push the offbeat eighth late
    const swung = time + (inBar % 4 === 2 ? SWING * this._sixteenth : 0);
    const human = () => (Math.random() - 0.5) * 0.012;
    const barDur = this._sixteenth * STEPS_PER_BAR;

    // ---- chord and bass, at the top of each bar
    if (inBar === 0) {
      chord.voicing.forEach((n, k) => {
        // roll the voicing slightly, like a hand rather than a grid
        const t = time + k * 0.018 + human();
        this._rhodes(n, t, barDur * 1.15, 0.115 + Math.random() * 0.035, (k - 2) * 0.16);
      });
      this._bass(chord.bass, time + human(), barDur * 0.55, 0.22);
      this._pad(chord.voicing.slice(0, 3), time, barDur * 1.3);
    }
    // a syncopated second chord stab, the lazy push that makes it feel lofi
    if (inBar === 11 && Math.random() < 0.75) {
      chord.voicing.forEach((n, k) => this._rhodes(n, swung + k * 0.012 + human(), barDur * 0.5, 0.065, (k - 2) * 0.16));
    }
    // walking note to the next bar
    if (inBar === 12) {
      const next = PROGRESSION[(bar + 1) % PROGRESSION.length].bass;
      this._bass(chord.bass, time + human(), this._sixteenth * 3, 0.15);
      if (Math.random() < 0.6) this._bass(next - 1, time + this._sixteenth * 2 + human(), this._sixteenth * 2, 0.12);
    }

    // ---- drums
    if (beat > 0.01) {
      if (KICK.includes(inBar) || (inBar === 6 && bar % 2 === 1)) this._kick(time + human(), (0.62 + Math.random() * 0.12) * beat);
      if (SNARE.includes(inBar)) this._snare(swung + human(), (0.5 + Math.random() * 0.1) * beat);
      // a fill at the end of every fourth bar
      if (bar % 4 === 3 && inBar === 14) this._snare(swung + human(), 0.34 * beat);
      if (HAT.includes(inBar)) {
        const accent = inBar % 4 === 0 ? 1 : 0.62;      // downbeats louder
        this._hat(swung + human(), accent * (0.55 + Math.random() * 0.35) * beat);
      }
    }

    // ---- sparse lead phrase, only once the track is open
    if (i > 0.55 && inBar === 8 && Math.random() < 0.3) {
      const n = LEAD_NOTES[Math.floor(Math.random() * LEAD_NOTES.length)];
      this._rhodes(n, swung + human(), barDur * 0.7, 0.10, (Math.random() - 0.5) * 0.9);
      if (Math.random() < 0.5) {
        const m = LEAD_NOTES[Math.floor(Math.random() * LEAD_NOTES.length)];
        this._rhodes(m, swung + this._sixteenth * 3, barDur * 0.6, 0.08, (Math.random() - 0.5) * 0.9);
      }
    }
  }

  _killVoices() {
    this._stops.forEach(n => { try { n.stop(); } catch (e) {} });
    this._stops = [];
  }

  /** Soft Rhodes note when a world is selected, in the key of the track. */
  chime(freq = 587.33) {
    if (!this.ctx || !this.playing) return;
    const note = 69 + 12 * Math.log2(freq / 440);
    this._rhodes(note, this.ctx.currentTime + 0.01, 2.6, 0.13, 0);
  }
}

// C major pentatonic, so selection chimes always sit inside the progression.
export const CHIME_SCALE = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
