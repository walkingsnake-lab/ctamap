'use strict';
// Sun position and moon phase for the skyline clock face (design spec, "Clock
// screen: skyline face", Choosing the state). No dependencies: NOAA's
// low-precision solar formulas (good to about 0.1°, plenty for a 64x32 sky)
// and the mean synodic month for the moon (within about half a day).

const RAD = Math.PI / 180;
const SYNODIC = 29.530588853;             // days, new moon to new moon
const NEW_MOON_EPOCH = 947182440;         // 2000-01-06 18:14 UTC, a new moon

// Sun elevation and azimuth (degrees; azimuth clockwise from north) at epoch
// seconds `t` for a place. Elevation is geometric (no refraction): the sun's
// center is on the horizon at 0°, so "sunset" (top limb plus refraction) is
// about -0.83°.
function sunPos(t, lat, lon) {
  const n = t / 86400 + 2440587.5 - 2451545.0;            // days since J2000
  const L = (((280.460 + 0.9856474 * n) % 360) + 360) % 360;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const h = (gmst * 15 + lon) * RAD - ra;
  const la = lat * RAD;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(h)) / RAD;
  const az = (Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / RAD + 540) % 360;
  return { el, az };
}

// The point on Earth with the sun overhead at epoch seconds `t`: declination
// and longitude in degrees (east positive, -180 to 180). Same series as sunPos.
function subsolar(t) {
  const n = t / 86400 + 2440587.5 - 2451545.0;
  const L = (((280.460 + 0.9856474 * n) % 360) + 360) % 360;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) / RAD;
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const lon = ((((ra - gmst * 15) % 360) + 540) % 360) - 180;
  return { dec, lon };
}

// Moon at epoch seconds `t`: phase 0-1 (0 new, 0.25 first quarter, 0.5 full,
// 0.75 last quarter) and the lit fraction of the disc, 0-1.
function moonPhase(t) {
  const days = (t - NEW_MOON_EPOCH) / 86400;
  const phase = (((days / SYNODIC) % 1) + 1) % 1;
  return { phase, lit: (1 - Math.cos(2 * Math.PI * phase)) / 2 };
}

// The time within 12 hours of `t` (either side) when the sun's elevation is
// `target` degrees, rising (`dir` 1) or setting (-1), nearest `t`; or with
// `target` 'max' / 'min', solar noon / midnight. Epoch seconds, to the
// minute, or null when the sun never reaches it (polar day or night). For
// the simulator's test times of day.
function sunTime(t, lat, lon, target, dir = -1) {
  const STEP = 60, t0 = t - 12 * 3600, n = (24 * 3600) / STEP;
  let best = null, bestEl = target === 'min' ? Infinity : -Infinity;
  let prev = sunPos(t0, lat, lon).el;
  for (let i = 1; i <= n; i++) {
    const ti = t0 + i * STEP, el = sunPos(ti, lat, lon).el;
    if (target === 'max' || target === 'min') {
      if (target === 'max' ? el > bestEl : el < bestEl) { bestEl = el; best = ti; }
    } else if ((dir > 0 ? prev < target && el >= target : prev > target && el <= target)
      && (best == null || Math.abs(ti - t) < Math.abs(best - t))) best = ti;
    prev = el;
  }
  return best;
}

module.exports = { sunPos, subsolar, moonPhase, sunTime, SYNODIC };
