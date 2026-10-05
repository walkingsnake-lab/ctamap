'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { shown, trackScores, nextDelay, url, PRE_S, FINAL_S, FAST_S, SLOW_S } = require('./mlb');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mlb', 'schedule-2026-10-03-alds-final.json'), 'utf8'));
const G = FIX.dates[0].games[0];               // CWS 3 @ CLE 0, ALDS Game 1, final
const START = Date.parse(G.gameDate) / 1000;    // 12:00 PM CDT

// The recorded game, edited into other situations.
function game(edit) {
  const g = structuredClone(G);
  edit(g);
  return g;
}
const schedule = (...games) => ({ ...FIX, dates: [{ ...FIX.dates[0], games }] });
const pre = (g) => {
  g.status = { abstractGameState: 'Preview', codedGameState: 'S', detailedState: 'Scheduled', statusCode: 'S' };
  delete g.teams.away.score; delete g.teams.home.score;
  g.teams.away.leagueRecord = { wins: 0, losses: 0 }; g.teams.home.leagueRecord = { wins: 0, losses: 0 };
  delete g.linescore;
};
const live = (ls) => (g) => {
  g.status = { abstractGameState: 'Live', codedGameState: 'I', detailedState: 'In Progress', statusCode: 'I' };
  g.teams.away.score = 2; g.teams.home.score = 1;
  Object.assign(g.linescore, ls);
};
const regularSeason = (awayId, homeId) => (g) => {
  g.gameType = 'R';
  g.teams.away.team.id = awayId; g.teams.home.team.id = homeId;
};

test('a final: abbreviations, runs, and records (postseason record in the postseason)', () => {
  const [g] = shown(FIX, START + 3 * 3600);
  assert.deepEqual(g, {
    id: 849829, st: 'final', start: START,
    away: { ab: 'CWS', c: '#a0a3a8', r: 3, w: 1, l: 0 },
    home: { ab: 'CLE', c: '#e50022', r: 0, w: 0, l: 1 },
  });
});

test('finals hold 15 min after the server first sees them', () => {
  const finals = new Map();
  const seen = START + 3 * 3600;
  assert.equal(shown(FIX, seen, finals).length, 1);
  assert.equal(shown(FIX, seen + FINAL_S - 1, finals).length, 1);
  assert.equal(shown(FIX, seen + FINAL_S, finals).length, 0);
});

test('a final first seen long after first pitch (server restart the next morning) is not shown', () => {
  assert.equal(shown(FIX, START + 7 * 3600).length, 0);
});

test('pregame shows from 30 min before first pitch, with 0-0 and the records', () => {
  const s = schedule(game(pre));
  assert.equal(shown(s, START - PRE_S - 1).length, 0);
  const [g] = shown(s, START - PRE_S);
  assert.equal(g.st, 'pre');
  assert.deepEqual(g.away, { ab: 'CWS', c: '#a0a3a8', r: 0, w: 0, l: 0 });
  // A delayed start stays in pregame.
  assert.equal(shown(s, START + 1800)[0].st, 'pre');
});

test('live: inning, half, count, outs, runners', () => {
  const s = schedule(game(live({
    currentInning: 7, inningState: 'Top', inningHalf: 'Top', balls: 2, strikes: 1, outs: 2,
    offense: { first: { id: 1 }, third: { id: 2 } },
  })));
  const [g] = shown(s, START + 7200);
  assert.deepEqual(
    { st: g.st, inn: g.inn, half: g.half, b: g.b, s: g.s, o: g.o, on: g.on, r: [g.away.r, g.home.r] },
    { st: 'live', inn: 7, half: 'T', b: 2, s: 1, o: 2, on: [1, 0, 1], r: [2, 1] },
  );
});

test('breaks: Middle and End come through as M and E for the same inning, empty', () => {
  const mid = shown(schedule(game(live({ currentInning: 4, inningState: 'Middle', balls: 0, strikes: 3, outs: 3, offense: { first: { id: 1 } } }))), START + 7200)[0];
  assert.deepEqual([mid.inn, mid.half, mid.o, mid.b, mid.s, mid.on], [4, 'M', 0, 0, 0, [0, 0, 0]]);
  const end = shown(schedule(game(live({ currentInning: 5, inningState: 'End', outs: 3 }))), START + 7200)[0];
  assert.deepEqual([end.inn, end.half], [5, 'E']);
});

test('which games: Cubs any time, other teams only in the postseason', () => {
  const t = START - 600;
  const cubsRegular = game((g) => { pre(g); regularSeason(112, 138)(g); g.gamePk = 1; });
  const otherRegular = game((g) => { pre(g); regularSeason(158, 138)(g); g.gamePk = 2; });
  const otherPost = game((g) => { pre(g); g.gamePk = 3; });
  assert.deepEqual(shown(schedule(otherPost, otherRegular, cubsRegular), t).map((g) => g.id), [1, 3]);
});

test('postponed games are skipped; games sort by first pitch', () => {
  const ppd = game((g) => { pre(g); g.status.detailedState = 'Postponed'; });
  assert.equal(shown(schedule(ppd), START - 600).length, 0);
  const late = game((g) => { pre(g); g.gamePk = 9; g.gameDate = '2026-10-03T21:00:00Z'; });
  const early = game((g) => { pre(g); g.gamePk = 8; });
  assert.deepEqual(shown(schedule(late, early), START - 600).map((g) => g.id), [8]);
  assert.deepEqual(shown(schedule(late, early), START + 4 * 3600 - 600).map((g) => g.id), [8, 9]);
});

test('poll fast while a game is live or about to start, slow otherwise', () => {
  assert.equal(nextDelay(FIX, START + 3 * 3600), SLOW_S);
  assert.equal(nextDelay(schedule(game(live({}))), START + 3600), FAST_S);
  assert.equal(nextDelay(schedule(game(pre)), START - PRE_S - 60), SLOW_S);
  assert.equal(nextDelay(schedule(game(pre)), START - PRE_S + 60), FAST_S);
});

test('schedule URL covers yesterday and today in Chicago, with the linescore', () => {
  const u = new URL(url(Date.parse('2026-10-04T00:30:00-05:00') / 1000));
  assert.equal(u.searchParams.get('startDate'), '2026-10-03');
  assert.equal(u.searchParams.get('endDate'), '2026-10-04');
  assert.equal(u.searchParams.get('hydrate'), 'linescore');
});

test('team map: all 30 teams, unique abbreviations, hex colors', () => {
  const { TEAMS } = require('./teams');
  const rows = Object.values(TEAMS);
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map((r) => r[0])).size, 30);
  for (const [, c] of rows) assert.match(c, /^#[0-9a-f]{6}$/);
});

test('score changes between polls are stamped on the live game, only for the team that scored', () => {
  const t = START + 7200;
  const s1 = schedule(game(live({ currentInning: 3 })));          // away 2, home 1
  const s2 = schedule(game((g) => { live({ currentInning: 3 })(g); g.teams.home.score = 2; }));
  const seen = new Map(), changes = new Map();
  trackScores(s1, t, seen, changes);                               // first sight: no flash
  assert.equal(shown(s1, t, new Map(), changes)[0].home.at, undefined);
  trackScores(s2, t + 15, seen, changes);
  const [g] = shown(s2, t + 20, new Map(), changes);
  assert.equal(g.home.at, t + 15);
  assert.equal(g.away.at, undefined);
  trackScores(s2, t + 30, seen, changes);                          // unchanged: stamp stays
  assert.equal(shown(s2, t + 31, new Map(), changes)[0].home.at, t + 15);
});

test('forced view: today\'s games all day from midnight; finals until 3 AM the next morning', () => {
  const { dayStart } = require('./mlb');
  const midnight = dayStart(START);                                   // 2026-10-03 00:00 CDT
  assert.equal(new Date(midnight * 1000).toISOString(), '2026-10-03T05:00:00.000Z');
  const s = schedule(game(pre));
  assert.equal(shown(s, midnight - 60, new Map(), new Map(), 'forced').length, 0);   // still yesterday
  assert.equal(shown(s, midnight + 60, new Map(), new Map(), 'forced')[0].st, 'pre');
  assert.equal(shown(s, midnight + 60).length, 0);                                    // auto: not yet
  // Final (12:00 PM game): through the evening and until 3 AM, not after.
  const f = (t) => shown(FIX, t, new Map(), new Map(), 'forced').length;
  assert.equal(f(START + 3 * 3600), 1);
  assert.equal(f(midnight + 86400 - 60), 1);                          // 11:59 PM
  assert.equal(f(midnight + 86400 + 3 * 3600 - 60), 1);               // 2:59 AM
  assert.equal(f(midnight + 86400 + 3 * 3600), 0);                    // 3:00 AM
  // Auto keeps its 15-minute hold; forced ignores the stale-final rule.
  assert.equal(shown(FIX, START + 7 * 3600).length, 0);
  assert.equal(f(START + 7 * 3600), 1);
});
