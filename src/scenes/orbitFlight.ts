import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three/webgpu';
import { circularSpeedKmS, viewDepression, type Orbit } from '../core/orbit';

// Layout of OrbitFlight.state. Every per-frame number lives in it (CLAUDE.md, frame loop).
/** Angle travelled = time (ms) · RATE + OFFSET, radians. */
const ANGLE = 0;
const RATE = 1;
const OFFSET = 2;
/** The previous frame's timestamp, ms. */
const CLOCK = 3;
/** 1 once the first timed frame has set OFFSET. */
const STARTED = 4;
/** Time factor, 1 = real speed. */
const FACTOR = 5;
/** Orbit radius, km: it changes when the height does. */
const RADIUS = 6;
/** How long the arrival from the camera's old pose takes, ms; 0 for none. */
const ARRIVAL = 7;
/** The first timed frame's timestamp, ms: the arrival starts there. */
const ARRIVAL_START = 8;
/** 4 × 4 column-major matrices: the orbit's frame, the camera at angle 0, and scratch. */
const BASE = 16;
const LOCAL = 32;
const SPUN = 48;
const WORLD = 64;
/** The pose the arrival starts from: position (km) and quaternion (x, y, z, w). */
const FROM_P = 80;
const FROM_Q = 83;
/** Earth's centre in scene coordinates, km (when given). */
const EARTH = 87;
/** 1 when an Earth position was given. */
const HAS_EARTH = 90;
/** The earthrise tilt now, radians, eased towards its target; and 1 once it has a value. */
const TILT = 91;
const TILT_READY = 92;
/** Milliseconds since the previous timed frame, for easing the tilt. */
const DT = 93;
const STATE_LENGTH = 94;

/**
 * The earthrise tilt (docs/stories/SS-11e.md). While Earth is above the horizon and within the
 * view's width, the camera pitches up just enough to keep it EARTH_MARGIN of the half field
 * below the top edge, never so far that the horizon drops below HORIZON_FLOOR of the half field
 * under the centre. It eases with a TILT_EASE_MS time constant (real milliseconds, whatever the
 * time factor), so it rises and settles like a camera operator, not a snap.
 */
const EARTH_MARGIN = 0.2;
const HORIZON_FLOOR = 0.6;
const TILT_EASE_MS = 1500;
/** Earth counts as up once its centre is this far over the limb (radians), fading in from 0. */
const EARTH_UP_FADE = (1 * Math.PI) / 180;
/** Beyond the view's half width by this much (radians), Earth no longer draws the camera up. */
const EARTH_SIDE_FADE = (4 * Math.PI) / 180;
/**
 * Once Earth has climbed past what the tilt can follow, the tilt lets go over this much more of
 * Earth's climb (radians), so the camera settles back to the terrain slowly, not with a drop.
 */
const EARTH_RELEASE = (25 * Math.PI) / 180;

/** An arrival takes this long, plus up to ARRIVAL_PER_TURN_MS for a half turn round the Moon. */
const ARRIVAL_MS = 3000;
const ARRIVAL_PER_TURN_MS = 3000;

/**
 * Flies a camera around a circular orbit (core/orbit.ts), looking ahead along the track and down
 * so the horizon sits above the centre of the view. The height can change in flight
 * (`setHeight`); the speed follows it, as a real circular orbit's would.
 *
 * The flight is one fixed pose, rotated about the orbit's normal by the angle travelled: in the
 * orbit's own frame x is the normal and y and z are the plane's u and v, so the rotation is about
 * x. `frame` runs in the frame loop. It works in one typed array and hands three.js the camera's
 * matrix in a single call: writing fractional numbers into three's vectors from our code
 * allocated on the frame path (docs/stories/SS-11b.md). While flying, the camera's matrix is not
 * rebuilt from its position and quaternion; `release` restores them.
 *
 * With `arrive`, the camera does not jump onto the orbit: it glides there from where it was, over
 * a few seconds, while the orbit itself carries on. Its direction from the Moon's centre turns on
 * a great circle, so it never passes through the Moon; its distance changes geometrically, and its
 * attitude turns by the shortest rotation. The glide eases in and out, so it joins the orbit's own
 * motion without a kink.
 */
export class OrbitFlight {
  readonly state = new Float64Array(STATE_LENGTH);
  private readonly camera: PerspectiveCamera;
  private readonly moonRadiusKm: number;
  private readonly gmKm3PerS2: number;
  /** 1 or -1: the direction of travel along v. */
  private readonly sign: number;

  constructor(
    camera: PerspectiveCamera,
    orbit: Orbit,
    moonRadiusKm: number,
    arrive = false,
    earthScene: readonly [number, number, number] | null = null,
  ) {
    this.camera = camera;
    this.moonRadiusKm = moonRadiusKm;
    this.sign = orbit.omega < 0 ? -1 : 1;
    // The orbit's own speed fixes GM: ω² r³.
    this.gmKm3PerS2 = orbit.omega * orbit.omega * orbit.radiusKm ** 3;
    const u = new Vector3(...orbit.u);
    const v = new Vector3(...orbit.v);
    const normal = new Vector3().crossVectors(u, v);
    new Matrix4().makeBasis(normal, u, v).toArray(this.state, BASE);

    this.state[ANGLE] = orbit.theta0;
    this.state[FACTOR] = 1;
    this.state[RADIUS] = orbit.radiusKm;
    this.state[RATE] = orbit.omega / 1000;
    if (earthScene !== null) {
      this.state[EARTH] = earthScene[0];
      this.state[EARTH + 1] = earthScene[1];
      this.state[EARTH + 2] = earthScene[2];
      this.state[HAS_EARTH] = 1;
    }
    this.buildLocal();
    if (arrive) {
      camera.updateMatrixWorld();
      const position = new Vector3().setFromMatrixPosition(camera.matrixWorld);
      const attitude = new Quaternion().setFromRotationMatrix(camera.matrixWorld);
      position.toArray(this.state, FROM_P);
      attitude.toArray(this.state, FROM_Q);
      this.place();
      // Longer the farther round the Moon the orbit starts.
      const target = new Vector3().fromArray(this.state, WORLD + 12);
      this.state[ARRIVAL] = ARRIVAL_MS + (ARRIVAL_PER_TURN_MS * position.angleTo(target)) / Math.PI;
    }
    camera.matrixAutoUpdate = false;
    this.place();
  }

  /** Advance to the frame at `timeMs` (the animation frame's own timestamp) and move the camera. */
  frame(timeMs: number | undefined): void {
    // three's animation loop makes its first call without a timestamp.
    if (timeMs === undefined) return;
    const s = this.state;
    s[DT] = s[STARTED] === 1 ? timeMs - (s[CLOCK] ?? timeMs) : 0;
    s[CLOCK] = timeMs;
    if (s[STARTED] === 0) {
      s[STARTED] = 1;
      s[ARRIVAL_START] = timeMs;
      s[OFFSET] = (s[ANGLE] ?? 0) - (s[RATE] ?? 0) * timeMs;
    }
    s[ANGLE] = (s[OFFSET] ?? 0) + (s[RATE] ?? 0) * timeMs;
    this.place();
  }

  /** Run time `factor` times faster than real, carrying on from where the orbit is now. */
  setTimeFactor(factor: number): void {
    this.state[FACTOR] = factor;
    this.retime();
  }

  /** Move to a circular orbit `heightKm` up, carrying on from the same point along the track. */
  setHeight(heightKm: number): void {
    this.state[RADIUS] = this.moonRadiusKm + heightKm;
    this.buildLocal();
    this.retime();
    this.place();
  }

  /** Hand the camera back: its position, quaternion and up again describe where it is. */
  release(): void {
    const camera = this.camera;
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camera.matrixAutoUpdate = true;
  }

  /** Height above the 1737.4 km sphere, km, and speed, km/s (real, before any time factor). */
  describe(): { heightKm: number; speedKmS: number } {
    const radiusKm = this.state[RADIUS] ?? 0;
    return {
      heightKm: radiusKm - this.moonRadiusKm,
      speedKmS: circularSpeedKmS(this.gmKm3PerS2, radiusKm),
    };
  }

  /** The angular rate for the current radius and time factor, keeping the angle continuous. */
  private retime(): void {
    const s = this.state;
    const radiusKm = s[RADIUS] ?? 0;
    const omega = (this.sign * circularSpeedKmS(this.gmKm3PerS2, radiusKm)) / radiusKm;
    s[RATE] = (omega * (s[FACTOR] ?? 1)) / 1000;
    if (s[STARTED] === 1) s[OFFSET] = (s[ANGLE] ?? 0) - (s[RATE] ?? 0) * (s[CLOCK] ?? 0);
  }

  /** The camera at angle 0, in the orbit's frame, for the current radius. */
  private buildLocal(): void {
    const radiusKm = this.state[RADIUS] ?? 0;
    const depression = viewDepression(
      this.moonRadiusKm,
      radiusKm - this.moonRadiusKm,
      (this.camera.fov * Math.PI) / 180,
    );
    // At angle 0 the camera is at radius along y, heading along ±z, looking down by `depression`.
    const position = new Vector3(0, radiusKm, 0);
    const target = new Vector3(0, -Math.sin(depression), this.sign * Math.cos(depression)).add(
      position,
    );
    const attitude = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(position, target, new Vector3(0, 1, 0)),
    );
    new Matrix4().compose(position, attitude, new Vector3(1, 1, 1)).toArray(this.state, LOCAL);
  }

  /** Put the camera where the orbit is now: WORLD = BASE · Rx(angle) · LOCAL. */
  private place(): void {
    const s = this.state;
    const c = Math.cos(s[ANGLE] ?? 0);
    const n = Math.sin(s[ANGLE] ?? 0);
    for (let col = 0; col < 16; col += 4) {
      const y = s[LOCAL + col + 1] ?? 0;
      const z = s[LOCAL + col + 2] ?? 0;
      s[SPUN + col] = s[LOCAL + col] ?? 0;
      s[SPUN + col + 1] = c * y - n * z;
      s[SPUN + col + 2] = n * y + c * z;
      s[SPUN + col + 3] = s[LOCAL + col + 3] ?? 0;
    }
    for (let col = 0; col < 16; col += 4) {
      for (let row = 0; row < 4; row++) {
        s[WORLD + col + row] =
          (s[BASE + row] ?? 0) * (s[SPUN + col] ?? 0) +
          (s[BASE + 4 + row] ?? 0) * (s[SPUN + col + 1] ?? 0) +
          (s[BASE + 8 + row] ?? 0) * (s[SPUN + col + 2] ?? 0) +
          (s[BASE + 12 + row] ?? 0) * (s[SPUN + col + 3] ?? 0);
      }
    }
    // The earthrise tilt (docs/stories/SS-11e.md): pitch WORLD up while Earth is rising in view.
    // WORLD's columns are the camera's right, up and back axes and its position.
    //
    // Written for V8's allocation behaviour on the frame path (CI's allocation gate): inside
    // place(), whose loops get it optimised early; only const locals; and no Math.atan2,
    // Math.min, Math.max or Math.abs, which V8's mid tier calls with boxed numbers where it
    // turns one-argument maths (sqrt, sin, cos, tan, asin, acos, atan, exp) into plain
    // arithmetic. |x| is written sqrt(x * x), and a clamp to 0..1 is
    // (sqrt(x^2) - sqrt((x - 1)^2) + 1) / 2.
    if (s[HAS_EARTH] === 1) {
      const px = s[WORLD + 12] ?? 0;
      const py = s[WORLD + 13] ?? 0;
      const pz = s[WORLD + 14] ?? 0;
      const dx = (s[EARTH] ?? 0) - px;
      const dy = (s[EARTH + 1] ?? 0) - py;
      const dz = (s[EARTH + 2] ?? 0) - pz;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ex = dx * inv;
      const ey = dy * inv;
      const ez = dz * inv;
      const ux = s[WORLD + 4] ?? 0;
      const uy = s[WORLD + 5] ?? 0;
      const uz = s[WORLD + 6] ?? 0;
      const bx = s[WORLD + 8] ?? 0;
      const by = s[WORLD + 9] ?? 0;
      const bz = s[WORLD + 10] ?? 0;
      const inFront = -(ex * bx + ey * by + ez * bz);
      const above = ex * ux + ey * uy + ez * uz;
      const aside = ex * (s[WORLD] ?? 0) + ey * (s[WORLD + 1] ?? 0) + ez * (s[WORLD + 2] ?? 0);

      const halfV = (this.camera.fov * Math.PI) / 360;
      const halfH = Math.atan(this.camera.aspect * Math.tan(halfV));
      const r = Math.sqrt(px * px + py * py + pz * pz);
      // The limb is `dip` below the local horizontal; the view centre is `depression` below it.
      const dip = Math.acos(this.moonRadiusKm / r);
      const elevation = Math.asin((ex * px + ey * py + ez * pz) / r);
      const depression = Math.asin((bx * px + by * py + bz * pz) / r);
      // Earth's angles from the view centre, up and sideways. Where Earth is behind (inFront
      // not positive) these are meaningless, and the weight below is zero there.
      const pitch = Math.atan(above / inFront);
      const yaw = Math.atan(Math.sqrt(aside * aside) / inFront);

      // Clamped fractions: Earth over the limb, beyond the view's width, and beyond what the
      // tilt may follow; and 1 where Earth is in front.
      const upF = (elevation + dip) / EARTH_UP_FADE;
      const up = 0.5 * (Math.sqrt(upF * upF) - Math.sqrt((upF - 1) * (upF - 1)) + 1);
      const sideF = (yaw - halfH) / EARTH_SIDE_FADE;
      const side = 0.5 * (Math.sqrt(sideF * sideF) - Math.sqrt((sideF - 1) * (sideF - 1)) + 1);
      const frontF = inFront * 1e6;
      const front = 0.5 * (Math.sqrt(frontF * frontF) - Math.sqrt((frontF - 1) * (frontF - 1)) + 1);
      // How far up it must pitch to keep Earth inside the top margin, and how far it may.
      const needed = pitch - (1 - EARTH_MARGIN) * halfV;
      const mostRaw = depression - dip + HORIZON_FLOOR * halfV;
      const most = 0.5 * (mostRaw + Math.sqrt(mostRaw * mostRaw));
      const relF = (needed - most) / EARTH_RELEASE;
      const release = 0.5 * (Math.sqrt(relF * relF) - Math.sqrt((relF - 1) * (relF - 1)) + 1);
      const weight =
        front *
        up *
        up *
        (3 - 2 * up) *
        (1 - side * side * (3 - 2 * side)) *
        (1 - release * release * (3 - 2 * release));
      // min(most, max(needed, 0)), without Math.min or Math.max.
      const neededPos = 0.5 * (needed + Math.sqrt(needed * needed));
      const capped = 0.5 * (most + neededPos - Math.sqrt((most - neededPos) * (most - neededPos)));
      const target = weight * capped;

      if (s[TILT_READY] === 0) {
        s[TILT] = target;
        s[TILT_READY] = 1;
      } else {
        s[TILT] =
          (s[TILT] ?? 0) + (target - (s[TILT] ?? 0)) * (1 - Math.exp(-(s[DT] ?? 0) / TILT_EASE_MS));
      }
      const tilt = s[TILT] ?? 0;
      if (tilt !== 0) {
        // Pitch up about the right axis: up' = up cos + back sin, back' = back cos - up sin.
        const tc = Math.cos(tilt);
        const tn = Math.sin(tilt);
        s[WORLD + 4] = ux * tc + bx * tn;
        s[WORLD + 5] = uy * tc + by * tn;
        s[WORLD + 6] = uz * tc + bz * tn;
        s[WORLD + 8] = bx * tc - ux * tn;
        s[WORLD + 9] = by * tc - uy * tn;
        s[WORLD + 10] = bz * tc - uz * tn;
      }
    }
    if ((s[ARRIVAL] ?? 0) > 0) this.arrive();
    this.camera.matrix.fromArray(s, WORLD);
    this.camera.matrixWorldNeedsUpdate = true;
  }

  /**
   * Blend WORLD, the orbit's pose now, with the pose the arrival started from, by how far through
   * the arrival the clock is (smootherstep, so it starts and ends at rest relative to the orbit).
   */
  private arrive(): void {
    const s = this.state;
    const duration = s[ARRIVAL] ?? 0;
    let t = 0;
    if (s[STARTED] === 1)
      t = Math.min(1, Math.max(0, ((s[CLOCK] ?? 0) - (s[ARRIVAL_START] ?? 0)) / duration));
    if (t >= 1) {
      s[ARRIVAL] = 0;
      return;
    }
    const w = t * t * t * (t * (t * 6 - 15) + 10);

    // Position: turn the direction on a great circle, scale the distance geometrically.
    const fx = s[FROM_P] ?? 0;
    const fy = s[FROM_P + 1] ?? 0;
    const fz = s[FROM_P + 2] ?? 0;
    const tx = s[WORLD + 12] ?? 0;
    const ty = s[WORLD + 13] ?? 0;
    const tz = s[WORLD + 14] ?? 0;
    const fr = Math.hypot(fx, fy, fz);
    const tr = Math.hypot(tx, ty, tz);
    const cosAngle = Math.min(1, Math.max(-1, (fx * tx + fy * ty + fz * tz) / (fr * tr)));
    const angle = Math.acos(cosAngle);
    const sinAngle = Math.sin(angle);
    let a = 1 - w;
    let b = w;
    if (sinAngle > 1e-9) {
      a = Math.sin((1 - w) * angle) / sinAngle;
      b = Math.sin(w * angle) / sinAngle;
    }
    const r = fr * Math.pow(tr / fr, w);
    let px = (a * fx) / fr + (b * tx) / tr;
    let py = (a * fy) / fr + (b * ty) / tr;
    let pz = (a * fz) / fr + (b * tz) / tr;
    const pr = Math.hypot(px, py, pz);
    px = (px / pr) * r;
    py = (py / pr) * r;
    pz = (pz / pr) * r;

    // Attitude: the orbit's rotation as a quaternion (as three's setFromRotationMatrix), then
    // the shortest turn from the starting attitude to it.
    const m11 = s[WORLD] ?? 0;
    const m21 = s[WORLD + 1] ?? 0;
    const m31 = s[WORLD + 2] ?? 0;
    const m12 = s[WORLD + 4] ?? 0;
    const m22 = s[WORLD + 5] ?? 0;
    const m32 = s[WORLD + 6] ?? 0;
    const m13 = s[WORLD + 8] ?? 0;
    const m23 = s[WORLD + 9] ?? 0;
    const m33 = s[WORLD + 10] ?? 0;
    const trace = m11 + m22 + m33;
    let qx: number;
    let qy: number;
    let qz: number;
    let qw: number;
    if (trace > 0) {
      const k = 0.5 / Math.sqrt(trace + 1);
      qw = 0.25 / k;
      qx = (m32 - m23) * k;
      qy = (m13 - m31) * k;
      qz = (m21 - m12) * k;
    } else if (m11 > m22 && m11 > m33) {
      const k = 2 * Math.sqrt(1 + m11 - m22 - m33);
      qw = (m32 - m23) / k;
      qx = 0.25 * k;
      qy = (m12 + m21) / k;
      qz = (m13 + m31) / k;
    } else if (m22 > m33) {
      const k = 2 * Math.sqrt(1 + m22 - m11 - m33);
      qw = (m13 - m31) / k;
      qx = (m12 + m21) / k;
      qy = 0.25 * k;
      qz = (m23 + m32) / k;
    } else {
      const k = 2 * Math.sqrt(1 + m33 - m11 - m22);
      qw = (m21 - m12) / k;
      qx = (m13 + m31) / k;
      qy = (m23 + m32) / k;
      qz = 0.25 * k;
    }
    const ax = s[FROM_Q] ?? 0;
    const ay = s[FROM_Q + 1] ?? 0;
    const az = s[FROM_Q + 2] ?? 0;
    const aw = s[FROM_Q + 3] ?? 1;
    let dot = ax * qx + ay * qy + az * qz + aw * qw;
    if (dot < 0) {
      qx = -qx;
      qy = -qy;
      qz = -qz;
      qw = -qw;
      dot = -dot;
    }
    let ka = 1 - w;
    let kb = w;
    if (dot < 0.9995) {
      const half = Math.acos(dot);
      const sinHalf = Math.sin(half);
      ka = Math.sin((1 - w) * half) / sinHalf;
      kb = Math.sin(w * half) / sinHalf;
    }
    let x = ka * ax + kb * qx;
    let y = ka * ay + kb * qy;
    let z = ka * az + kb * qz;
    let q = ka * aw + kb * qw;
    const norm = Math.hypot(x, y, z, q);
    x /= norm;
    y /= norm;
    z /= norm;
    q /= norm;

    // WORLD = the blended pose (as three's Matrix4.compose, unit scale).
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    s[WORLD] = 1 - (y * y2 + z * z2);
    s[WORLD + 1] = x * y2 + q * z2;
    s[WORLD + 2] = x * z2 - q * y2;
    s[WORLD + 4] = x * y2 - q * z2;
    s[WORLD + 5] = 1 - (x * x2 + z * z2);
    s[WORLD + 6] = y * z2 + q * x2;
    s[WORLD + 8] = x * z2 + q * y2;
    s[WORLD + 9] = y * z2 - q * x2;
    s[WORLD + 10] = 1 - (x * x2 + y * y2);
    s[WORLD + 12] = px;
    s[WORLD + 13] = py;
    s[WORLD + 14] = pz;
  }
}
