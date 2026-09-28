import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import {
  circularSpeedKmS,
  horizonDip,
  randomOrbit,
  seededRandom,
  viewDepression,
} from '../core/orbit';
import { OrbitFlight } from './orbitFlight';

const R = 1737.4;
const GM = 4902.800118457549;

/** Where core/orbit.ts puts the orbit at angle `theta`: r (cos θ · u + sin θ · v). */
function expected(orbit: ReturnType<typeof randomOrbit>, theta: number): Vector3 {
  const u = new Vector3(...orbit.u);
  const v = new Vector3(...orbit.v);
  return u
    .multiplyScalar(Math.cos(theta))
    .addScaledVector(v, Math.sin(theta))
    .multiplyScalar(orbit.radiusKm);
}

/** Where the camera is drawn from: its world matrix, which the flight sets directly. */
function at(camera: PerspectiveCamera): Vector3 {
  camera.updateMatrixWorld();
  return new Vector3().setFromMatrixPosition(camera.matrixWorld);
}

describe('orbit flight', () => {
  for (const seed of [1, 7, 42]) {
    it(`flies orbit ${seed} where the orbit maths says, at its speed and with any time factor`, () => {
      const camera = new PerspectiveCamera(50, 1, 0.01, 1e7);
      const orbit = randomOrbit(seededRandom(seed), R, GM, 300, [1, 0, 0]);
      const flight = new OrbitFlight(camera, orbit, R);
      expect(at(camera).distanceTo(expected(orbit, orbit.theta0))).toBeLessThan(1e-9 * R);

      // three's animation loop calls its first frame without a timestamp: nothing moves.
      flight.frame(undefined);
      expect(at(camera).distanceTo(expected(orbit, orbit.theta0))).toBeLessThan(1e-9 * R);
      // The first timed frame starts the clock; 100 s later it has gone ω · 100 s round.
      flight.frame(5000);
      flight.frame(105000);
      let theta = orbit.theta0 + orbit.omega * 100;
      expect(at(camera).distanceTo(expected(orbit, theta))).toBeLessThan(1e-6);

      // ×100 carries on from there without a jump.
      flight.setTimeFactor(100);
      flight.frame(105000);
      expect(at(camera).distanceTo(expected(orbit, theta))).toBeLessThan(1e-6);
      flight.frame(115000);
      theta += orbit.omega * 100 * 10;
      expect(at(camera).distanceTo(expected(orbit, theta))).toBeLessThan(1e-6);
    });
  }

  it('looks ahead along the track, with the horizon above the centre of the view', () => {
    const camera = new PerspectiveCamera(50, 1, 0.01, 1e7);
    const orbit = randomOrbit(seededRandom(3), R, GM, 300, [1, 0, 0]);
    new OrbitFlight(camera, orbit, R);
    const position = at(camera);
    const view = camera.getWorldDirection(new Vector3());
    const up = position.clone().normalize();
    const height = orbit.radiusKm - R;
    // The view's centre is `viewDepression` below the local horizontal.
    const depression = Math.asin(-view.dot(up));
    expect(depression).toBeCloseTo(viewDepression(R, height, (50 * Math.PI) / 180), 9);
    expect(depression).toBeGreaterThan(horizonDip(R, height));
    // Heading: along the direction of motion.
    const next = expected(orbit, orbit.theta0 + Math.sign(orbit.omega) * 1e-3);
    const motion = next.sub(position).normalize();
    expect(view.dot(motion)).toBeGreaterThan(0.5);
    // No roll: the screen's up lies in the plane of the view and the local vertical.
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    expect(right.dot(up)).toBeCloseTo(0, 9);
  });

  it('hands the camera back where it is, for the gestures to carry on from', () => {
    const camera = new PerspectiveCamera(50, 1, 0.01, 1e7);
    const orbit = randomOrbit(seededRandom(5), R, GM, 300, [1, 0, 0]);
    const flight = new OrbitFlight(camera, orbit, R);
    flight.frame(1000);
    flight.frame(61000);
    const flown = at(camera);
    const view = camera.getWorldDirection(new Vector3());
    flight.release();
    expect(camera.matrixAutoUpdate).toBe(true);
    camera.updateMatrixWorld();
    expect(camera.position.distanceTo(flown)).toBeLessThan(1e-9 * R);
    expect(camera.getWorldDirection(new Vector3()).dot(view)).toBeCloseTo(1, 12);
  });

  it('changes height in flight: same point along the track, the new height, its circular speed', () => {
    const camera = new PerspectiveCamera(50, 1, 0.01, 1e7);
    const orbit = randomOrbit(seededRandom(9), R, GM, 300, [1, 0, 0]);
    const flight = new OrbitFlight(camera, orbit, R);
    flight.frame(1000);
    flight.frame(31000);
    const before = at(camera);
    flight.setHeight(900);
    const after = at(camera);
    // Straight up from where it was: same direction from the centre, 900 km up.
    expect(after.clone().normalize().dot(before.clone().normalize())).toBeCloseTo(1, 12);
    expect(after.length()).toBeCloseTo(R + 900, 9);
    const { heightKm, speedKmS } = flight.describe();
    expect(heightKm).toBeCloseTo(900, 9);
    expect(speedKmS).toBeCloseTo(circularSpeedKmS(GM, R + 900), 9);
    // 100 s later it has gone the new speed's distance round.
    flight.frame(131000);
    const angle = after.angleTo(at(camera));
    expect(angle * (R + 900)).toBeCloseTo(circularSpeedKmS(GM, R + 900) * 100, 6);
  });

  it('with arrive, glides from the old view onto the orbit, outside the Moon, and joins it', () => {
    const camera = new PerspectiveCamera(50, 1, 0.01, 1e7);
    // Far out on the other side of the Moon from where the orbit starts, looking at the centre.
    const orbit = randomOrbit(seededRandom(11), R, GM, 300, [1, 0, 0]);
    const start = expected(orbit, orbit.theta0)
      .normalize()
      .multiplyScalar(-6 * R);
    start.add(new Vector3(0, 0, R));
    camera.position.copy(start);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const startView = camera.getWorldDirection(new Vector3());
    const flight = new OrbitFlight(camera, orbit, R, true);

    // Nothing moves until the first timed frame, and then it starts from where it was.
    expect(at(camera).distanceTo(start)).toBeLessThan(1e-6);
    flight.frame(undefined);
    flight.frame(1000);
    expect(at(camera).distanceTo(start)).toBeLessThan(1e-6);
    expect(camera.getWorldDirection(new Vector3()).dot(startView)).toBeCloseTo(1, 9);

    // On the way: always outside the Moon, and each step small (no jumps).
    let previous = at(camera);
    let longest = 0;
    for (let t = 1000; t <= 1000 + 6000; t += 16) {
      flight.frame(t);
      const now = at(camera);
      expect(now.length()).toBeGreaterThan(R + 300 - 1e-6);
      longest = Math.max(longest, now.distanceTo(previous));
      previous = now;
    }
    // The longest step is a few percent of the way, not a jump.
    expect(longest).toBeLessThan(0.02 * start.distanceTo(expected(orbit, orbit.theta0)));

    // After the arrival (at most 6 s) it is exactly on the orbit, as a flight without it would be.
    flight.frame(61000);
    const plain = new PerspectiveCamera(50, 1, 0.01, 1e7);
    const reference = new OrbitFlight(plain, orbit, R);
    reference.frame(1000);
    reference.frame(61000);
    expect(at(camera).distanceTo(at(plain))).toBeLessThan(1e-6);
    expect(
      camera.getWorldDirection(new Vector3()).dot(plain.getWorldDirection(new Vector3())),
    ).toBeCloseTo(1, 12);
  });

  describe('the earthrise tilt (docs/stories/SS-11e.md)', () => {
    // The iPhone's portrait view (60 degrees tall, 390 x 844), 400 km up, at x10 time.
    const FOV = 60;
    const ASPECT = 390 / 844;
    const orbit = randomOrbit(seededRandom(21), R, GM, 400, [1, 0, 0]);
    const u = new Vector3(...orbit.u);
    const v = new Vector3(...orbit.v);
    const sign = Math.sign(orbit.omega);
    // Earth in the orbit's plane, 120 degrees ahead of the start, at its real distance.
    const ahead = orbit.theta0 + sign * ((120 * Math.PI) / 180);
    const earth = u
      .clone()
      .multiplyScalar(Math.cos(ahead))
      .addScaledVector(v, Math.sin(ahead))
      .multiplyScalar(384_400);
    const earthTuple: [number, number, number] = [earth.x, earth.y, earth.z];

    /** Per 16 ms frame through the rise: Earth in frame, Earth up and in view's width, the horizon. */
    function fly(withEarth: boolean): { inFrame: boolean; horizon: number; view: Vector3 }[] {
      const camera = new PerspectiveCamera(FOV, ASPECT, 0.01, 1e7);
      const flight = new OrbitFlight(camera, orbit, R, false, withEarth ? earthTuple : null);
      flight.setTimeFactor(10);
      const out = [];
      for (let t = 0; t < 400_000; t += 16) {
        flight.frame(t);
        const position = at(camera);
        const toEarth = earth.clone().sub(position).normalize();
        const up = position.clone().normalize();
        const dip = Math.acos(R / position.length());
        const ndc = earth.clone().project(camera);
        const view = camera.getWorldDirection(new Vector3());
        const visible = toEarth.dot(view) > 0 && Math.asin(toEarth.dot(up)) > -dip;
        // The limb's angle above the view centre: the view's depression minus the dip.
        const horizon = Math.asin(-view.dot(up)) - dip;
        out.push({
          inFrame: visible && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
          horizon,
          view,
        });
      }
      return out;
    }

    const plain = fly(false);
    const tilted = fly(true);
    const halfV = (FOV * Math.PI) / 360;

    it('keeps a rising Earth in frame at least twice as long as the plain flight', () => {
      const count = (frames: { inFrame: boolean }[]): number =>
        frames.filter((f) => f.inFrame).length;
      expect(count(plain)).toBeGreaterThan(0);
      expect(count(tilted)).toBeGreaterThan(2 * count(plain));
    });

    it('never pushes the horizon more than the floor below the centre of the view', () => {
      for (const f of tilted) expect(f.horizon).toBeGreaterThan(-0.6 * halfV - 1e-6);
    });

    it('moves the view smoothly: no frame turns it by more than a small step', () => {
      let largest = 0;
      for (let i = 1; i < tilted.length; i++) {
        const a = tilted[i]?.view ?? new Vector3();
        const b = tilted[i - 1]?.view ?? new Vector3();
        largest = Math.max(largest, a.angleTo(b));
      }
      expect(largest).toBeLessThan((0.1 * Math.PI) / 180);
    });

    it('changes nothing while Earth is behind', () => {
      const camera = new PerspectiveCamera(FOV, ASPECT, 0.01, 1e7);
      const behind: [number, number, number] = [-earth.x, -earth.y, -earth.z];
      const flight = new OrbitFlight(camera, orbit, R, false, behind);
      const reference = new PerspectiveCamera(FOV, ASPECT, 0.01, 1e7);
      const plainFlight = new OrbitFlight(reference, orbit, R);
      for (const t of [0, 16, 1000]) {
        flight.frame(t);
        plainFlight.frame(t);
        expect(at(camera).distanceTo(at(reference))).toBeLessThan(1e-9);
        expect(
          camera.getWorldDirection(new Vector3()).dot(reference.getWorldDirection(new Vector3())),
        ).toBeCloseTo(1, 12);
      }
    });
  });
});
