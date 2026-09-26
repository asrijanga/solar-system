import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three/webgpu';
import { viewDepression, type Orbit } from '../core/orbit';

// Layout of OrbitFlight.state. Every per-frame number lives in it (CLAUDE.md, frame loop).
/** Angle travelled = time (ms) · RATE + OFFSET, radians. */
const ANGLE = 0;
const RATE = 1;
const OFFSET = 2;
/** The previous frame's timestamp, ms. */
const CLOCK = 3;
/** 1 once the first timed frame has set OFFSET. */
const STARTED = 4;
/** 4 × 4 column-major matrices: the orbit's frame, the camera at angle 0, and scratch. */
const BASE = 16;
const LOCAL = 32;
const SPUN = 48;
const WORLD = 64;
const STATE_LENGTH = 80;

/**
 * Flies a camera around a circular orbit (core/orbit.ts), looking ahead along the track and down
 * so the horizon sits above the centre of the view.
 *
 * The flight is one fixed pose, rotated about the orbit's normal by the angle travelled: in the
 * orbit's own frame x is the normal and y and z are the plane's u and v, so the rotation is about
 * x. `frame` runs in the frame loop. It works in one typed array and hands three.js the camera's
 * matrix in a single call: writing fractional numbers into three's vectors from our code
 * allocated on the frame path (docs/stories/SS-11b.md). While flying, the camera's matrix is not
 * rebuilt from its position and quaternion; `release` restores them.
 */
export class OrbitFlight {
  readonly orbit: Orbit;
  readonly state = new Float64Array(STATE_LENGTH);
  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, orbit: Orbit, moonRadiusKm: number) {
    this.camera = camera;
    this.orbit = orbit;
    const u = new Vector3(...orbit.u);
    const v = new Vector3(...orbit.v);
    const normal = new Vector3().crossVectors(u, v);
    new Matrix4().makeBasis(normal, u, v).toArray(this.state, BASE);

    const depression = viewDepression(
      moonRadiusKm,
      orbit.radiusKm - moonRadiusKm,
      (camera.fov * Math.PI) / 180,
    );
    // At angle 0 the camera is at radius along y, heading along ±z, looking down by `depression`.
    const sign = orbit.omega < 0 ? -1 : 1;
    const position = new Vector3(0, orbit.radiusKm, 0);
    const target = new Vector3(0, -Math.sin(depression), sign * Math.cos(depression)).add(position);
    const attitude = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(position, target, new Vector3(0, 1, 0)),
    );
    new Matrix4().compose(position, attitude, new Vector3(1, 1, 1)).toArray(this.state, LOCAL);

    this.state[ANGLE] = orbit.theta0;
    this.state[RATE] = orbit.omega / 1000;
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
    const s = this.state;
    s[RATE] = (this.orbit.omega * factor) / 1000;
    if (s[STARTED] === 1) s[OFFSET] = (s[ANGLE] ?? 0) - (s[RATE] ?? 0) * (s[CLOCK] ?? 0);
  }

  /** Hand the camera back: its position, quaternion and up again describe where it is. */
  release(): void {
    const camera = this.camera;
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camera.matrixAutoUpdate = true;
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

  /** Height above the 1737.4 km sphere, km, and speed, km/s (real, before any time factor). */
  describe(moonRadiusKm: number): { heightKm: number; speedKmS: number } {
    return {
      heightKm: this.orbit.radiusKm - moonRadiusKm,
      speedKmS: Math.abs(this.orbit.omega) * this.orbit.radiusKm,
    };
  }
}
