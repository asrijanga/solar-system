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
/** 4 × 4 column-major matrices: the orbit's frame, the camera at angle 0, and scratch. */
const BASE = 16;
const LOCAL = 32;
const SPUN = 48;
const WORLD = 64;
const STATE_LENGTH = 80;

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
 */
export class OrbitFlight {
  readonly state = new Float64Array(STATE_LENGTH);
  private readonly camera: PerspectiveCamera;
  private readonly moonRadiusKm: number;
  private readonly gmKm3PerS2: number;
  /** 1 or -1: the direction of travel along v. */
  private readonly sign: number;

  constructor(camera: PerspectiveCamera, orbit: Orbit, moonRadiusKm: number) {
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
    this.buildLocal();
    camera.matrixAutoUpdate = false;
    this.place();
  }

  /** Advance to the frame at `timeMs` (the animation frame's own timestamp) and move the camera. */
  frame(timeMs: number | undefined): void {
    // three's animation loop makes its first call without a timestamp.
    if (timeMs === undefined) return;
    const s = this.state;
    s[CLOCK] = timeMs;
    if (s[STARTED] === 0) {
      s[STARTED] = 1;
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
    this.camera.matrix.fromArray(s, WORLD);
    this.camera.matrixWorldNeedsUpdate = true;
  }
}
