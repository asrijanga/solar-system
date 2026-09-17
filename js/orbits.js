// Orbital mechanics: heliocentric positions from JPL Keplerian elements.
// Reference: https://ssd.jpl.nasa.gov/planets/approx_pos.html
const DEG = Math.PI / 180;
export const J2000_JD = 2451545.0;

export function dateToJD(date) { return date.getTime() / 86400000 + 2440587.5; }
export function jdToDate(jd) { return new Date((jd - 2440587.5) * 86400000); }

function solveKepler(M, e) {
  // M in radians. Newton iteration, converges quickly for e < 0.98.
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

/** Heliocentric ecliptic position (AU) for planet elements at Julian date jd. Returns {x,y,z} with z = ecliptic north. */
export function planetPosition(el, jd) {
  const T = (jd - J2000_JD) / 36525;
  const a = el.a + el.da * T, e = el.e + el.de * T, i = (el.i + el.di * T) * DEG;
  const L = el.L + el.dL * T, lp = el.longPeri + el.dPeri * T, ln = el.longNode + el.dNode * T;
  const w = (lp - ln) * DEG, W = ln * DEG;
  let M = ((L - lp) % 360 + 540) % 360 - 180;
  const E = solveKepler(M * DEG, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const r = perifocalToEcliptic(xp, yp, w, W, i); r.phase = ((E % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI); return r;
}

/** Position for a comet given classic elements and time of perihelion (JD). */
export function cometPosition(c, jd) {
  const n = 360 / (c.periodYears * 365.25); // deg/day
  let M = ((n * (jd - c.perihelionJD)) % 360 + 360) % 360;
  const E = solveKepler(M * DEG, c.e);
  const xp = c.a * (Math.cos(E) - c.e), yp = c.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
  const r = perifocalToEcliptic(xp, yp, c.argPeri * DEG, c.longNode * DEG, c.i * DEG); r.phase = ((E % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI); return r;
}

function perifocalToEcliptic(xp, yp, w, W, i) {
  const cw = Math.cos(w), sw = Math.sin(w), cW = Math.cos(W), sW = Math.sin(W), ci = Math.cos(i), si = Math.sin(i);
  const x = (cw * cW - sw * sW * ci) * xp + (-sw * cW - cw * sW * ci) * yp;
  const y = (cw * sW + sw * cW * ci) * xp + (-sw * sW + cw * cW * ci) * yp;
  const z = (sw * si) * xp + (cw * si) * yp;
  return { x, y, z };
}

/** Sample a full orbit as an array of {x,y,z} (AU) for drawing orbit lines. */
export function orbitPath(el, jd, samples = 360) {
  const T = (jd - J2000_JD) / 36525;
  const a = el.a + el.da * T, e = el.e + el.de * T, i = (el.i + el.di * T) * DEG;
  const lp = el.longPeri + el.dPeri * T, ln = el.longNode + el.dNode * T;
  const w = (lp - ln) * DEG, W = ln * DEG;
  const pts = [];
  for (let k = 0; k <= samples; k++) {
    const E = (k / samples) * Math.PI * 2;
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    pts.push(perifocalToEcliptic(xp, yp, w, W, i));
  }
  return pts;
}
export function cometPath(c, samples = 720) {
  const pts = [];
  for (let k = 0; k <= samples; k++) {
    const E = (k / samples) * Math.PI * 2;
    const xp = c.a * (Math.cos(E) - c.e), yp = c.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
    pts.push(perifocalToEcliptic(xp, yp, c.argPeri * DEG, c.longNode * DEG, c.i * DEG));
  }
  return pts;
}
