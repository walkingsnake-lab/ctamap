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
// Builds are signed (ECDSA P-256 over SHA-256 of the .bin, a hex DER
// signature): CI signs with the private key, which only the
// firmware-release GitHub environment holds; the public key is
// firmware-s3/firmware-signing.pub.pem (scripts/firmware-key.js). An
// upload must carry a valid signature, and the board checks it again
// before switching to a build (device.cpp Ota::finish). Without a public
// key in the repo, no upload is accepted.
//
// Only generic builds are accepted: the firmware embeds a build mark
// (`CTABOARD-BUILD:<version>:<generic|setup>;`, ctaboard.ino), and a setup
// build has secrets.h compiled in (WiFi passwords, the token), so it must
// never be stored or sent to another board.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const setup = require('./setup-image');
const { tzOffset } = require('./time');

const FILE_NAME = 'firmware.json';
const SUBDIR = 'firmware';
const MAX_BYTES = 2 * 1024 * 1024;   // the app slot in the default partition scheme (TinyUF2 8MB: 2 MB)
const MAX_BUILDS = 8;                // older builds not in a channel or pinned are pruned
const CHANNELS = ['beta', 'stable'];
// Boards on stable install only overnight, Chicago time [from, to) hours, so
// nobody watches one restart; beta and pinned builds install right away.
const STABLE_HOURS = [2, 5];
const BOOT_S = 120;
const inStableWindow = (now) => {
  const h = new Date((now + tzOffset(now)) * 1000).getUTCHours();
  return h >= STABLE_HOURS[0] && h < STABLE_HOURS[1];
};
const ESP_IMAGE_MAGIC = 0xe9;
const ESP32S3_CHIP_ID = 9;           // esp_image_header_t.chip_id
const MARK_RE = /CTABOARD-BUILD:([A-Za-z0-9_]{1,48}):(generic|setup);/;
const VERSION_RE = /^[0-9a-f]{7,40}$/;
const HARDWARE = 'adafruit_matrixportal_s3';
const PUBLIC_KEY_FILE = path.join(__dirname, '..', '..', 'firmware-s3', 'firmware-signing.pub.pem');
const SIG_RE = /^[0-9a-f]{16,200}$/;

// The public key builds are signed with, or null when the repo has none yet.
function loadPublicKey(file = PUBLIC_KEY_FILE) {
  let pem;
  try { pem = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  if (!pem.includes('BEGIN PUBLIC KEY')) return null;
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') {
    throw new Error(`${file}: not an ECDSA P-256 public key`);
  }
  return key;
}

// Whether `sig` (hex DER) is a signature of `buf` by `key`.
function verifySignature(buf, sig, key) {
  if (!key || typeof sig !== 'string' || !SIG_RE.test(sig)) return false;
  try { return crypto.verify('sha256', buf, key, Buffer.from(sig, 'hex')); } catch (e) { return false; }
}

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

// A build's boot image (for setting up a board from the browser, contract
// "Firmware"): the merged image's first part, everything before the first
// app slot (bootloader, partition table, the initial OTA data). With the
// app it makes the image a new board is flashed with. Returns its partition
// facts; throws FirmwareError saying what's wrong.
function inspectBoot(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 0x9000 || buf[0] !== ESP_IMAGE_MAGIC) {
    throw new FirmwareError('not a boot image: upload ctaboard.ino.boot.bin (scripts/split-merged.js makes it from the merged image)');
  }
  if (buf.readUInt16LE(12) !== ESP32S3_CHIP_ID) throw new FirmwareError('the bootloader is for another chip');
  const parts = setup.partitions(buf);
  const nvs = parts.find((p) => p.type === 1 && p.subtype === 2);
  const slots = parts.filter((p) => p.type === 0 && (p.subtype === 0x10 || p.subtype === 0x11));
  if (!nvs || slots.length < 2) throw new FirmwareError('no partition table with an NVS partition and two OTA app slots');
  if (slots[0].offset !== buf.length) throw new FirmwareError(`the boot image must end where the first app slot starts (${slots[0].offset} bytes; got ${buf.length})`);
  if (slots[0].size < MAX_BYTES) throw new FirmwareError('the first app slot is smaller than an app build may be');
  // The initial OTA data (arduino-esp32's boot_app0) must be there and pick
  // a slot: erased, the bootloader would start the TinyUF2 factory app.
  const ota = parts.find((p) => p.type === 1 && p.subtype === 0);
  if (!ota || ota.offset + 32 > buf.length) throw new FirmwareError('no OTA data partition in the boot image');
  if (buf.readUInt32LE(ota.offset) === 0xffffffff) throw new FirmwareError('the OTA data is erased: the boot image has no boot_app0');
  return { nvs, app: slots[0] };
}

// stableWindow(now): whether stable installs are allowed at epoch second now.
function createFirmware({ dir, log = console, publicKey = loadPublicKey(), stableWindow = inStableWindow } = {}) {
  if (!publicKey) log.warn('[board] no firmware signing key (firmware-s3/firmware-signing.pub.pem): OTA uploads are refused until scripts/firmware-key.js makes one');
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
  const bootOf = (v) => path.join(root, `${v}.boot.bin`);
  const unlinkBuild = (v) => { for (const f of [binOf(v), bootOf(v)]) try { fs.unlinkSync(f); } catch (_) { /* already gone */ } };
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
      unlinkBuild(v);
      n--;
    }
  }

  function status() {
    const builds = Object.entries(state.builds)
      .map(([v, b]) => ({ v, size: b.size, sha: b.sha, at: b.at, signed: !!b.sig, boot: !!b.boot }))
      .sort((a, b) => b.at - a.at);
    return { builds, channels: { ...state.channels }, signing: !!publicKey };
  }

  return {
    status,
    has: (v) => Object.hasOwn(state.builds, v),

    // Store an uploaded build with its signature (hex); `channel` (beta,
    // stable, or null) then points at it.
    upload(buf, { sig = null, channel = null, pinned = [], now = Math.floor(Date.now() / 1000) } = {}) {
      if (channel != null && !CHANNELS.includes(channel)) throw new FirmwareError(`channel must be one of ${CHANNELS.join(', ')}`);
      const { v } = inspect(buf);
      if (!publicKey) throw new FirmwareError('no signing key yet: run node scripts/firmware-key.js (firmware-s3/README.md, "Signed builds")');
      if (!sig) throw new FirmwareError('unsigned: upload the build with its .sig (the CI artifact has both)');
      if (!verifySignature(buf, String(sig).trim().toLowerCase(), publicKey)) throw new FirmwareError('the signature doesn\'t match this build and the repo\'s signing key');
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      fs.mkdirSync(root, { recursive: true });
      const tmp = `${binOf(v)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, binOf(v));
      state.builds[v] = { size: buf.length, sha, at: now, sig: String(sig).trim().toLowerCase() };
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
      unlinkBuild(v);
      save();
      return status();
    },

    // A stored build's boot image (inspectBoot), signed like the build.
    attachBoot(v, buf, { sig = null } = {}) {
      if (!Object.hasOwn(state.builds, v)) throw new FirmwareError(`unknown build: ${v} (upload the app first)`);
      inspectBoot(buf);
      if (!publicKey) throw new FirmwareError('no signing key yet: run node scripts/firmware-key.js (firmware-s3/README.md, "Signed builds")');
      if (!sig) throw new FirmwareError('unsigned: upload the boot image with its .sig');
      const s = String(sig).trim().toLowerCase();
      if (!verifySignature(buf, s, publicKey)) throw new FirmwareError('the signature doesn\'t match this boot image and the repo\'s signing key');
      fs.mkdirSync(root, { recursive: true });
      const tmp = `${bootOf(v)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, bootOf(v));
      state.builds[v].boot = { size: buf.length, sha: crypto.createHash('sha256').update(buf).digest('hex'), sig: s };
      save();
      log.warn(`[board] firmware ${v}: boot image attached (${buf.length} bytes)`);
      return status();
    },

    // What a new board is flashed with (Set up a board): the boot image and
    // the app right after it, i.e. the merged image up to the app's end.
    // Null without a boot image. Both files are checked against the
    // signatures they were stored with.
    image(v) {
      const b = Object.hasOwn(state.builds, v) ? state.builds[v] : null;
      if (!b || !b.boot) return null;
      const boot = fs.readFileSync(bootOf(v)), app = fs.readFileSync(binOf(v));
      if (!verifySignature(boot, b.boot.sig, publicKey) || !verifySignature(app, b.sig, publicKey)) {
        throw new FirmwareError(`build ${v}'s stored files don't match their signatures`);
      }
      return Buffer.concat([boot, app]);
    },

    // The build a board's `fw` setting names: a channel's, a pinned one, or none (off).
    target(fw) {
      const v = fw === 'off' ? null : CHANNELS.includes(fw) ? state.channels[fw] : fw;
      return v && Object.hasOwn(state.builds, v) ? { v, ...state.builds[v] } : null;
    },

    // The offer for /board/version (`fw`), or null: only for an S3 running a
    // committed build (a board running `dev` or `_dirty` is someone's test
    // build and is left alone), and only when it isn't already running it.
    // A board on stable gets it only in the overnight window (STABLE_HOURS),
    // or in its first minutes after starting (BOOT_S of uptime, `hu`): a
    // board unplugged every night still updates, while nobody watches it yet.
    offer(board, q, now = Math.floor(Date.now() / 1000)) {
      if (q.hd !== HARDWARE) return null;
      const running = String(q.hv || '');
      if (!VERSION_RE.test(running)) return null;
      const fw = board.fw || 'stable';
      const justStarted = q.hu != null && Number(q.hu) >= 0 && Number(q.hu) < BOOT_S;
      if (fw === 'stable' && !stableWindow(now) && !justStarted) return null;
      const t = this.target(fw);
      if (!t || t.v === running) return null;
      return { v: t.v, size: t.size, sha: t.sha, n: board.fwRetry || 0, ...(t.sig ? { sig: t.sig } : {}) };
    },

    file: (v) => (Object.hasOwn(state.builds, v) ? { path: binOf(v), size: state.builds[v].size } : null),
  };
}

module.exports = { createFirmware, inStableWindow, STABLE_HOURS, inspect, inspectBoot, loadPublicKey, verifySignature, PUBLIC_KEY_FILE, FirmwareError, CHANNELS, MAX_BYTES, MAX_BUILDS, VERSION_RE };
