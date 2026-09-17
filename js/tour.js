// The cold open.
//
// A keyframed camera move that starts at the surface of the Sun and pulls back
// until the whole Solar System is a smudge against the Milky Way. It exists
// because the model defaults to true scale, where the planets really are
// specks: the sequence teaches you how to read that before handing over control.
//
// Every step gets a start and end camera pose, an eased interpolation, a line of
// text and a target music intensity. Distances are interpolated logarithmically
// so a move from 2 units to 4000 units feels linear rather than exploding.

import * as THREE from 'three';

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;

export class Cinematic {
  /**
   * @param ctx  { camera, controls, byId, sunBody, AU_SCALE, soundtrack, onEnd }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.active = false;
    this.step = 0;
    this.t = 0;
    this.caption = document.getElementById('caption');
    this.skipBtn = document.getElementById('skip');
    this._onSkip = () => this.end(true);
  }

  _earth() { return this.ctx.byId.get('earth'); }

  /** Camera pose helpers. Each returns { pos, target }. */
  _poseAround(target, distance, dir) {
    return { pos: target.clone().addScaledVector(dir.clone().normalize(), distance), target: target.clone() };
  }

  _steps() {
    const S = this.ctx.AU_SCALE;
    const sun = this.ctx.sunBody;
    const O = new THREE.Vector3(0, 0, 0);

    return [
      {
        // Close enough that the granulation fills the frame.
        dur: 6.0, ease: easeOut, intensity: 0.32,
        text: 'One ordinary star,<br>four and a half billion years old.',
        from: () => this._poseAround(O, sun.radius * 2.6, new THREE.Vector3(0.3, 0.18, 1)),
        to: () => this._poseAround(O, sun.radius * 7.5, new THREE.Vector3(0.1, 0.30, 1)),
      },
      {
        dur: 6.5, ease: easeInOut, intensity: 0.45,
        text: 'It holds 99.86% of all the matter<br>in the Solar System.',
        from: () => this._poseAround(O, sun.radius * 7.5, new THREE.Vector3(0.1, 0.30, 1)),
        to: () => this._poseAround(O, S * 1.9, new THREE.Vector3(0.05, 0.42, 1)),
      },
      {
        // Drop onto Earth. This is the only time the tour gets close to a world.
        dur: 6.5, ease: easeInOut, intensity: 0.6,
        text: 'You are here.',
        from: () => this._poseAround(O, S * 1.9, new THREE.Vector3(0.05, 0.42, 1)),
        to: () => {
          const e = this._earth();
          const sunward = e.pos.clone().negate().normalize();
          const dir = sunward.clone().multiplyScalar(0.8).add(new THREE.Vector3(0.25, 0.42, 0.1)).normalize();
          return this._poseAround(e.pos, e.radius * 3.4, dir);
        },
      },
      {
        dur: 3.0, ease: t => t, intensity: 0.66, hold: true,
        text: 'Every person who has ever lived,<br>every story ever told.',
        from: () => {
          const e = this._earth();
          const sunward = e.pos.clone().negate().normalize();
          const dir = sunward.clone().multiplyScalar(0.8).add(new THREE.Vector3(0.25, 0.42, 0.1)).normalize();
          return this._poseAround(e.pos, e.radius * 3.4, dir);
        },
        to: () => {
          const e = this._earth();
          const sunward = e.pos.clone().negate().normalize();
          const dir = sunward.clone().multiplyScalar(0.8).add(new THREE.Vector3(0.45, 0.46, 0.1)).normalize();
          return this._poseAround(e.pos, e.radius * 5.2, dir);
        },
      },
      {
        // The reveal: Earth shrinks to nothing.
        dur: 7.0, ease: easeIn, intensity: 0.8,
        text: 'Nothing here is exaggerated.<br>This is the true size of things.',
        from: () => {
          const e = this._earth();
          const sunward = e.pos.clone().negate().normalize();
          const dir = sunward.clone().multiplyScalar(0.8).add(new THREE.Vector3(0.45, 0.46, 0.1)).normalize();
          return this._poseAround(e.pos, e.radius * 5.2, dir);
        },
        to: () => this._poseAround(O, S * 7.5, new THREE.Vector3(0.45, 0.40, 1)),
      },
      {
        dur: 7.0, ease: easeInOut, intensity: 0.92,
        text: 'Out past the frost line:<br>Jupiter, Saturn, and their eighty moons.',
        from: () => this._poseAround(O, S * 7.5, new THREE.Vector3(0.45, 0.40, 1)),
        to: () => this._poseAround(O, S * 26, new THREE.Vector3(0.30, 0.55, 1)),
      },
      {
        // Climax. The whole system, small, against the galaxy.
        dur: 8.0, ease: easeInOut, intensity: 1.0,
        text: 'Sunlight takes four hours to reach the edge.<br>The next star is four years further.',
        from: () => this._poseAround(O, S * 26, new THREE.Vector3(0.30, 0.55, 1)),
        to: () => this._poseAround(O, S * 78, new THREE.Vector3(0.12, 0.72, 1)),
      },
      {
        dur: 6.0, ease: easeInOut, intensity: 0.62,
        text: 'All of it is yours to explore.<br><em>Click any world.</em>',
        from: () => this._poseAround(O, S * 78, new THREE.Vector3(0.12, 0.72, 1)),
        to: () => this._poseAround(O, S * 11, new THREE.Vector3(0.18, 0.46, 1)),
      },
    ];
  }

  start() {
    this.active = true;
    this.step = 0;
    this.t = 0;
    this.seq = this._steps();
    this._begin();
    if (this.skipBtn) {
      this.skipBtn.classList.add('show');
      this.skipBtn.addEventListener('click', this._onSkip);
    }
    window.addEventListener('keydown', this._keyHandler = e => { if (e.key === 'Escape') this.end(true); });
    // Any deliberate drag hands control back immediately.
    this.ctx.controls.domElement.addEventListener('pointerdown', this._onSkip, { once: true });
  }

  _begin() {
    const s = this.seq[this.step];
    this._from = s.from();
    this._to = s.to();
    this.ctx.soundtrack.setIntensity(s.intensity, Math.max(3, s.dur * 0.8));
    this._showCaption(s.text, s.dur);
  }

  _showCaption(html, dur) {
    if (!this.caption) return;
    this.caption.innerHTML = `<span>${html}</span>`;
    this.caption.classList.remove('show');
    // restart the CSS transition on the next frame
    requestAnimationFrame(() => requestAnimationFrame(() => this.caption.classList.add('show')));
    clearTimeout(this._capTimer);
    this._capTimer = setTimeout(() => this.caption.classList.remove('show'), Math.max(1400, (dur - 0.5) * 1000));
  }

  /** Called every frame with wall-clock delta. Returns true while it owns the camera. */
  update(dt) {
    if (!this.active) return false;
    const s = this.seq[this.step];
    this.t += dt / s.dur;

    if (this.t >= 1) {
      this.step++;
      if (this.step >= this.seq.length) { this.end(false); return false; }
      this.t = 0;
      this._begin();
      return true;
    }

    const e = s.ease(Math.min(1, this.t));
    // Re-evaluate endpoints each frame: the planets keep moving underneath us.
    const from = s.from(), to = s.to();

    const o0 = from.pos.clone().sub(from.target);
    const o1 = to.pos.clone().sub(to.target);
    const l0 = Math.max(1e-6, o0.length()), l1 = Math.max(1e-6, o1.length());

    // The look-at point has to lead the camera, otherwise a dive onto a world
    // spends its middle staring at the empty space between here and there.
    // Approaching: swing onto the destination early, then it is a pure zoom.
    // Retreating: hold on the world we are leaving so it visibly shrinks away.
    let targetE;
    if (l1 < l0 * 0.5) targetE = Math.min(1, e * 3);
    else if (l1 > l0 * 2) targetE = Math.max(0, (e - 0.45) / 0.55);
    else targetE = e;
    const target = from.target.clone().lerp(to.target, targetE);

    const len = Math.exp(THREE.MathUtils.lerp(Math.log(l0), Math.log(l1), e));
    const dir = o0.normalize().lerp(o1.normalize(), e).normalize();

    this.ctx.camera.position.copy(target).addScaledVector(dir, len);
    this.ctx.controls.target.copy(target);
    return true;
  }

  end(skipped) {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this._capTimer);
    if (this.caption) this.caption.classList.remove('show');
    if (this.skipBtn) { this.skipBtn.classList.remove('show'); this.skipBtn.removeEventListener('click', this._onSkip); }
    window.removeEventListener('keydown', this._keyHandler);
    this.ctx.controls.domElement.removeEventListener('pointerdown', this._onSkip);
    this.ctx.soundtrack.setIntensity(0.58, 10);
    this.ctx.onEnd?.(skipped);
  }
}
