'use strict';
// MLB teams for the baseball screen (design spec §8): Stats API team ID ->
// abbreviation (as /api/v1/teams sends it) and the board's block color.
// Colors start from each team's primary color; dark navies, maroons, and
// browns are brightened (or swapped for the team's brighter color) so the
// 3px block reads as color on the panel, like Brown/Purple on the transit
// screen. Check them on the panel (open question in the spec).

const TEAMS = {
  108: ['LAA', '#ba0021'], 109: ['AZ', '#c41e3a'], 110: ['BAL', '#df4601'], 111: ['BOS', '#c8323d'],
  112: ['CHC', '#2a5bd8'], 113: ['CIN', '#d50032'], 114: ['CLE', '#e50022'], 115: ['COL', '#7b68c8'],
  116: ['DET', '#3a66b0'], 117: ['HOU', '#eb6e1f'], 118: ['KC', '#1f6fd0'], 119: ['LAD', '#1e78d2'],
  120: ['WSH', '#c8102e'], 121: ['NYM', '#ff5910'], 133: ['ATH', '#1f8a5a'], 134: ['PIT', '#fdb827'],
  135: ['SD', '#8b6a45'], 136: ['SEA', '#1aa3a3'], 137: ['SF', '#fd5a1e'], 138: ['STL', '#d62a2a'],
  139: ['TB', '#8fbce6'], 140: ['TEX', '#2f62c8'], 141: ['TOR', '#1f6ed8'], 142: ['MIN', '#d31145'],
  143: ['PHI', '#e81828'], 144: ['ATL', '#ce1141'], 145: ['CWS', '#a0a3a8'], 146: ['MIA', '#00a3e0'],
  147: ['NYY', '#3a5fa8'], 158: ['MIL', '#ffc52f'],
};

const team = (id) => {
  const t = TEAMS[id];
  return t ? { ab: t[0], c: t[1] } : null;
};

module.exports = { TEAMS, team };
