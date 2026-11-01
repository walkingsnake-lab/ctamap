'use strict';
// OTA builds for the S3 firmware (contract: "Firmware"; design spec §10,
// "OTA updates").
//
// Builds are uploaded from the control page as the Arduino IDE's .bin (or a
// CI build) and kept beside the board state (BOARD_STATE_DIR / the Fly
// volume) under firmware/, never in the repo. Two channels name a build
// each: `beta` (the owner's boards, first) and `stable` (everyone else).
// Each board follows a channel, is pinned to one build, or is off (state
// `fw`); /board/version offers it the build it should run, and
// /board/firmware serves it.
//
// Only generic builds are accepted: the firmware embeds a build mark
// (`CTABOARD-BUILD:<version>:<generic|setup>;`, ctaboard.ino), and a setup
// build has secrets.h compiled in (WiFi passwords, the token), so it must
// never be stored or sent to another board.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'firmware.json';
const SUBDIR = 'firmware';
const MAX_BYTES = 2 * 1024 * 1024;   // the app slot in the default partition scheme (TinyUF2 8MB: 2 MB)
const MAX_BUILDS = 8;                // older builds not in a channel or pinned are pruned
const CHANNELS = ['beta', 'stable'];
const ESP_IMAGE_MAGIC = 0xe9;
const ESP32S3_CHIP_ID = 9;           // esp_image_header_t.chip_id
const MARK_RE = /CTABOARD-BUILD:([A-Za-z0-9_]{1,48}):(generic|setup);/;
const VERSION_RE = /^[0-9a-f]{7,40}$/;
const HARDWARE = 'adafruit_matrixportal_s3';

class FirmwareError extends Error {}

// What an uploaded file is: { v } for a generic S3 build of this firmware;
// throws FirmwareError saying what's wrong otherwise.
function inspect(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 64 || buf[0] !== ESP_IMAGE_MAGIC) {
    throw new FirmwareError('not an ESP32 app image: upload ctaboard.ino.bin (Sketch → Export Compiled Binary, or the CI build)');
  }
  // The merged image (bootloader + partition table + app) starts with the
  // bootloader, whose header looks the same; its partition table at 0x8000 gives it away.
  if (buf.length > 0x8002 && buf[0x8000] === 0xaa && buf[0x8001] === 0x50) {
    throw new FirmwareError('this is the merged image (ctaboard.ino.merged.bin): upload ctaboard.ino.bin');
  }
  if (buf.length > MAX_BYTES) throw new FirmwareError(`too big for the app slot (${buf.length} bytes; max ${MAX_BYTES})`);
  if (buf.readUInt16LE(12) !== ESP32S3_CHIP_ID) throw new FirmwareError('built for another chip: pick Adafruit MatrixPortal ESP32-S3 as the board');
  const m = buf.toString('latin1').match(MARK_RE);
  if (!m) throw new FirmwareError('not a CTA board build (no build mark; builds from before OTA support can only be flashed over USB)');
  const [, v, kind] = m;
  if (kind === 'setup') {
    throw new FirmwareError('built with secrets.h, so it has your WiFi passwords and token in it: build without secrets.h (README, "OTA updates")');
  }
  if (v === 'dev') throw new FirmwareError('unstamped build: run node scripts/stamp-firmware-version.js, then build again');
  if (v.endsWith('_dirty')) throw new FirmwareError('built with uncommitted changes (_dirty): commit, stamp, and build again');
  if (!VERSION_RE.test(v)) throw new FirmwareError(`unexpected build version: ${v}`);
  return { v };
}

function createFirmware({ dir, log = console } = {}) {
  const root = path.join(dir, SUBDIR);
  const file = path.join(root, FILE_NAME);
  let state = { builds: {}, channels: { beta: null, stable: null } };
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s.builds === 'object' && typeof s.channels === 'object') state = s;
  } catch (e) {
    if (e.code !== 'ENOENT') log.error(`[board] firmware index unreadable (${e.message}); starting empty`);
  }
  for (const ch of CHANNELS) if (!(state.channels[ch] in state.builds)) state.channels[ch] = null;

  const binOf = (v) => path.join(root, `${v}.bin`);
  function save() {
    fs.mkdirSync(root, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tmp, file);
  }

  // Oldest first, past MAX_BUILDS, except builds in a channel or pinned.
  function prune(pinned) {
    const keep = new Set([...Object.values(state.channels), ...pinned]);
    const old = Object.entries(state.builds).sort((a, b) => a[1].at - b[1].at).map(([v]) => v);
    let n = old.length;
    for (const v of old) {
      if (n <= MAX_BUILDS) break;
      if (keep.has(v)) continue;
      delete state.builds[v];
      try { fs.unlinkSync(binOf(v)); } catch (_) { /* already gone */ }
      n--;
    }
  }

  function status() {
    const builds = Object.entries(state.builds)
      .map(([v, b]) => ({ v, size: b.size, sha: b.sha, at: b.at }))
      .sort((a, b) => b.at - a.at);
    return { builds, channels: { ...state.channels } };
  }

  return {
    status,
    has: (v) => Object.hasOwn(state.builds, v),

    // Store an uploaded build; `channel` (beta, stable, or null) then points at it.
    upload(buf, { channel = null, pinned = [], now = Math.floor(Date.now() / 1000) } = {}) {
      if (channel != null && !CHANNELS.includes(channel)) throw new FirmwareError(`channel must be one of ${CHANNELS.join(', ')}`);
      const { v } = inspect(buf);
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      fs.mkdirSync(root, { recursive: true });
      const tmp = `${binOf(v)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, binOf(v));
      state.builds[v] = { size: buf.length, sha, at: now };
      if (channel) state.channels[channel] = v;
      prune(pinned);
      save();
      log.warn(`[board] firmware ${v} uploaded (${buf.length} bytes)${channel ? `, now ${channel}` : ''}`);
      return status();
    },

    // Point a channel at a stored build, or at none (null).
    setChannel(channel, v) {
      if (!CHANNELS.includes(channel)) throw new FirmwareError(`channel must be one of ${CHANNELS.join(', ')}`);
      if (v != null && !Object.hasOwn(state.builds, v)) throw new FirmwareError(`unknown build: ${v}`);
      state.channels[channel] = v ?? null;
      save();
      return status();
    },

    // Delete a stored build that no channel or board uses.
    remove(v, pinned = []) {
      if (!Object.hasOwn(state.builds, v)) throw new FirmwareError(`unknown build: ${v}`);
      const ch = CHANNELS.find((c) => state.channels[c] === v);
      if (ch) throw new FirmwareError(`${v} is the ${ch} build; point ${ch} at another build first`);
      if (pinned.includes(v)) throw new FirmwareError(`a board is pinned to ${v}`);
      delete state.builds[v];
      try { fs.unlinkSync(binOf(v)); } catch (_) { /* already gone */ }
      save();
      return status();
    },

    // The build a board's `fw` setting names: a channel's, a pinned one, or none (off).
    target(fw) {
      const v = fw === 'off' ? null : CHANNELS.includes(fw) ? state.channels[fw] : fw;
      return v && Object.hasOwn(state.builds, v) ? { v, ...state.builds[v] } : null;
    },

    // The offer for /board/version (`fw`), or null: only for an S3 running a
    // committed build (a board running `dev` or `_dirty` is someone's test
    // build and is left alone), and only when it isn't already running it.
    offer(board, q) {
      if (q.hd !== HARDWARE) return null;
      const running = String(q.hv || '');
      if (!VERSION_RE.test(running)) return null;
      const t = this.target(board.fw || 'stable');
      if (!t || t.v === running) return null;
      return { v: t.v, size: t.size, sha: t.sha, n: board.fwRetry || 0 };
    },

    file: (v) => (Object.hasOwn(state.builds, v) ? { path: binOf(v), size: state.builds[v].size } : null),
  };
}

module.exports = { createFirmware, inspect, FirmwareError, CHANNELS, MAX_BYTES, MAX_BUILDS, VERSION_RE };
