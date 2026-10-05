'use strict';
// Baseball for the board (design spec §8): MLB Stats API schedule with the
// linescore hydrated, which carries everything the screen draws (score,
// inning, count, outs, runners, records), so there's no per-game live feed.
//
// Shown games: every Cubs game and every postseason game, from 30 min before
// first pitch until 15 min after the final. Polled every 15 s while any game
// is live or about to start, every 5 min otherwise. Keeps the last good
// response on failure.

const { fetchJson } = require('./location-poller');
const { team } = require('./teams');
const { TZ } = require('./time');

const BASE = 'https://statsapi.mlb.com/api/v1/schedule';
const CUBS = 112;
const POSTSEASON = new Set(['F', 'D', 'L', 'W']); // wild card, division, LCS, World Series
const PRE_S = 30 * 60;     // pregame shows from 30 min before first pitch
const FINAL_S = 15 * 60;   // finals hold 15 min after the server first sees them
const STALE_S = 6 * 3600;  // a final first seen this long after first pitch is old news
const FAST_S = 15, SLOW_S = 300;
const SKIP_STATES = /postponed|cancel/i;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const chicagoDate = (t) => dayFmt.format(new Date(t * 1000)); // YYYY-MM-DD

// Yesterday through today (Chicago dates), so a late game stays after midnight.
function url(now) {
  const q = new URLSearchParams({
    sportId: '1', startDate: chicagoDate(now - 86400), endDate: chicagoDate(now), hydrate: 'linescore',
  });
  return `${BASE}?${q}`;
}

const qualifies = (g) => g.teams.away.team.id === CUBS || g.teams.home.team.id === CUBS || POSTSEASON.has(g.gameType);

// One team: abbreviation, block color, runs (0 before first pitch), W-L.
// In the postseason the API's leagueRecord is the team's postseason record.
function side(t) {
  const tm = team(t.team.id);
  return {
    ab: tm.ab,
    c: tm.c,
    r: t.score != null ? t.score : 0,
    w: t.leagueRecord ? t.leagueRecord.wins : null,
    l: t.leagueRecord ? t.leagueRecord.losses : null,
  };
}

// Live game state from the linescore. half: T (top), B (bottom), or the
// breaks the API reports as inningState: M (Middle, after the top) and
// E (End, after the bottom). Breaks have nobody on, no count, no outs.
function liveState(ls) {
  const state = ls.inningState || ls.inningHalf || 'Top';
  const inn = ls.currentInning || 1;
  const half = { Top: 'T', Bottom: 'B', Middle: 'M', End: 'E' }[state] || 'T';
  const brk = half === 'M' || half === 'E';
  const off = ls.offense || {};
  return {
    inn, half,
    b: brk ? 0 : ls.balls || 0,
    s: brk ? 0 : ls.strikes || 0,
    o: brk ? 0 : ls.outs || 0,
    on: brk ? [0, 0, 0] : [off.first ? 1 : 0, off.second ? 1 : 0, off.third ? 1 : 0],
  };
}

// Schedule JSON -> the games to show at `now`, in start order.
// `finals` (gamePk -> epoch first seen final) is updated in place.
function shown(json, now, finals = new Map(), changes = new Map()) {
  const out = [];
  for (const d of (json && json.dates) || []) {
    for (const g of d.games || []) {
      if (!qualifies(g)) continue;
      if (!team(g.teams.away.team.id) || !team(g.teams.home.team.id)) continue;
      const status = g.status || {};
      if (SKIP_STATES.test(status.detailedState || '')) continue;
      const start = Math.round(Date.parse(g.gameDate) / 1000);
      const abstract = status.abstractGameState;
      const game = {
        id: g.gamePk,
        st: abstract === 'Final' ? 'final' : abstract === 'Live' ? 'live' : 'pre',
        start,
        away: side(g.teams.away),
        home: side(g.teams.home),
      };
      if (game.st === 'pre' && now < start - PRE_S) continue;
      if (game.st === 'final') {
        if (!finals.has(g.gamePk)) finals.set(g.gamePk, now - start > STALE_S ? -Infinity : now);
        if (now - finals.get(g.gamePk) >= FINAL_S) continue;
      }
      if (game.st === 'live') {
        Object.assign(game, liveState(g.linescore || {}));
        const ch = changes.get(g.gamePk) || {};
        if (ch.away != null) game.away.at = ch.away;
        if (ch.home != null) game.home.at = ch.home;
      }
      out.push(game);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.id - b.id);
}

// Remember when each live team's score last changed between two polls, so the
// board can flash it. `seen` (gamePk -> last scores) and `changes` (gamePk ->
// {away, home} epoch s) are updated in place. A game first seen mid-game
// (server restart) doesn't flash.
function trackScores(json, now, seen, changes) {
  for (const d of (json && json.dates) || []) {
    for (const g of d.games || []) {
      if (!qualifies(g) || (g.status || {}).abstractGameState !== 'Live') continue;
      const cur = { away: g.teams.away.score || 0, home: g.teams.home.score || 0 };
      const prev = seen.get(g.gamePk);
      if (prev) {
        const ch = changes.get(g.gamePk) || {};
        for (const k of ['away', 'home']) if (cur[k] !== prev[k]) ch[k] = now;
        changes.set(g.gamePk, ch);
      }
      seen.set(g.gamePk, cur);
    }
  }
}

// Fast polling while anything is live or within the pregame window.
function nextDelay(json, now) {
  for (const d of (json && json.dates) || []) {
    for (const g of d.games || []) {
      if (!qualifies(g)) continue;
      const st = (g.status || {}).abstractGameState;
      if (st === 'Live') return FAST_S;
      if (st === 'Preview' && Date.parse(g.gameDate) / 1000 - now <= PRE_S) return FAST_S;
    }
  }
  return SLOW_S;
}

function createMlb({ fetch = fetchJson, now = () => Date.now() / 1000, log = console } = {}) {
  let raw = null;
  let timer = null;
  const finals = new Map();
  const seen = new Map(), changes = new Map();

  async function refresh() {
    try { raw = await fetch(url(now())); trackScores(raw, now(), seen, changes); }
    catch (e) { log.error('[board] mlb failed:', e.message); }
  }

  function schedule() {
    const delay = raw ? nextDelay(raw, now()) : 60;
    timer = setTimeout(async () => { await refresh(); schedule(); }, delay * 1000);
    timer.unref();
  }

  return {
    // Games to show now ([] when none, or before the first fetch).
    get() {
      try { return raw ? shown(raw, now(), finals, changes) : []; }
      catch (e) { log.error('[board] mlb parse failed:', e.message); return []; }
    },
    raw: () => raw,
    start() {
      if (!timer) refresh().then(schedule, schedule);
      return this;
    },
    stop() { clearTimeout(timer); timer = null; },
    refresh,
  };
}

module.exports = { createMlb, shown, trackScores, nextDelay, url, qualifies, CUBS, PRE_S, FINAL_S, FAST_S, SLOW_S };
