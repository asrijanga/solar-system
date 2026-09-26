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
});
