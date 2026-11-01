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

// Moon at epoch seconds `t`: phase 0-1 (0 new, 0.25 first quarter, 0.5 full,
// 0.75 last quarter) and the lit fraction of the disc, 0-1.
function moonPhase(t) {
  const days = (t - NEW_MOON_EPOCH) / 86400;
  const phase = (((days / SYNODIC) % 1) + 1) % 1;
  return { phase, lit: (1 - Math.cos(2 * Math.PI * phase)) / 2 };
}

module.exports = { sunPos, moonPhase, SYNODIC };
