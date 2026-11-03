'use strict';
// Per-board credentials (contract: "Board keys").
//
// A board set up for someone else gets its own token (sent by the board as
// X-Board-Token; only its SHA-256 is stored) and its own control link,
// /board/c/<link>/, which opens the control page for that one board. Boards
// without a key (the owner's) keep using the shared BOARD_TOKEN and the
// owner's control path.
//
// Kept beside the board state in board-keys.json, never in board-state.json:
// the owner's control page reads that file whole (api/state).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'board-keys.json';
const LINK_RE = /^[A-Za-z0-9_-]{22}$/;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const random = (bytes) => crypto.randomBytes(bytes).toString('base64url');

function createKeys({ dir, log = console } = {}) {
  const file = path.join(dir, FILE_NAME);
  let keys = {}; // board id -> { sha (hex), link, at, wipe? (pending stamp), last? (newest stamp made) }
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s.boards === 'object') keys = s.boards;
  } catch (e) {
    if (e.code !== 'ENOENT') log.error(`[board] keys file unreadable (${e.message}); boards fall back to the shared token`);
  }
  const byLink = new Map(Object.entries(keys).map(([id, k]) => [k.link, id]));
  // Board IDs come from request URLs: only the file's own entries count
  // (not `__proto__`, `constructor`, ...).
  const keyOf = (id) => (Object.hasOwn(keys, id) ? keys[id] : null);

  function save() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ boards: keys }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    has: (id) => Object.hasOwn(keys, id),

    // A new token and link for board `id` (replacing any it had). The token
    // is returned only here: it goes into that board's flash.
    issue(id, now = Math.floor(Date.now() / 1000)) {
      const old = keyOf(id);
      if (old) byLink.delete(old.link);
      const token = random(24);
      const link = random(16);
      // A new token means a reflash, which clears the board's WiFi anyway: no
      // pending wipe carries over (the last stamp does, so stamps keep growing).
      keys[id] = { sha: sha(token).toString('hex'), link, at: now, ...(old && old.last ? { last: old.last } : {}) };
      byLink.set(link, id);
      save();
      return { token, link };
    },

    // A new control link (the old one stops working); the token stays.
    relink(id) {
      const k = keyOf(id);
      if (!k) return null;
      byLink.delete(k.link);
      k.link = random(16);
      byLink.set(k.link, id);
      save();
      return k.link;
    },

    // true / false for a keyed board; null when the board has no key (use the shared token).
    check(id, given) {
      const k = keyOf(id);
      if (!k) return null;
      const a = sha(given || '');
      const b = Buffer.from(k.sha, 'hex');
      return given != null && a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    // A new owner (transfer): a new control link (the old one stops working)
    // and, with `wipe`, a WiFi wipe stamped `now`. The board forgets its
    // saved networks once for each stamp newer than the last one it applied
    // (so stamps only grow), and the stamp is dropped once the board reports
    // it applied (applied()), so a later reflash isn't wiped again.
    transfer(id, { now = Math.floor(Date.now() / 1000), wipe = true } = {}) {
      const k = keyOf(id);
      if (!k) return null;
      byLink.delete(k.link);
      k.link = random(16);
      if (wipe) k.wipe = k.last = Math.max(now, (k.last || 0) + 1);
      byLink.set(k.link, id);
      save();
      return { link: k.link, wipe: wipe ? k.wipe : null };
    },
    wipeOf: (id) => (keyOf(id) && keyOf(id).wipe) || 0,
    // The board reports the newest stamp it has applied (health hz).
    applied(id, stamp) {
      const k = keyOf(id);
      if (!k || !k.wipe || !(stamp >= k.wipe)) return;
      delete k.wipe;
      save();
    },

    linkOf: (id) => (keyOf(id) ? keyOf(id).link : null),
    idForLink: (link) => (LINK_RE.test(String(link)) ? byLink.get(link) ?? null : null),

    remove(id) {
      if (!keyOf(id)) return;
      byLink.delete(keys[id].link);
      delete keys[id];
      save();
    },
  };
}

module.exports = { createKeys };
