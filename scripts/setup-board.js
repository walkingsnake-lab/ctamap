#!/usr/bin/env node
'use strict';
// Sets up a Matrix Portal S3 board in one command, without the Arduino IDE
// (firmware-s3/README.md, "Setting up a board"):
//
//   node scripts/setup-board.js --id kitchen --label "Kitchen"
//
// 1. Gets the generic build (the CI artifact matching the server's stable
//    build, else the newest on main; or --firmware <merged.bin>).
// 2. On the server: adds the board if it's new (a copy of --from, default
//    home) and gives it its own token and owner link (keys.js). --shared
//    uses the shared BOARD_TOKEN instead (your own boards).
// 3. Builds the board's settings (src/config.h: board ID, token, server,
//    setup network name and password, optional --wifi) into an NVS image.
// 4. Flashes build and settings with esptool in one pass.
// 5. Writes a printable label (~/board-labels/<id>-label.html, outside the
//    repo: it holds the owner link): a QR code that
//    joins the board's setup network, and one for the owner link.
//
// Needs: Python with `pip install esptool esp-idf-nvs-partition-gen`; the
// GitHub CLI (gh) unless --firmware is given; BOARD_CONTROL_PATH (and
// BOARD_TOKEN with --shared) in the environment, or --control / --token.
// The board's token is never written to disk outside a temp folder that's
// deleted afterwards. --dry-run does everything except changing the server
// and flashing (a placeholder token goes into the image).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { parseArgs } = require('util');

const ROOT = path.join(__dirname, '..');
const REPO = 'walkingsnake-lab/ctamap';
const WORKFLOW = 'firmware-s3.yml';
const DEFAULT_SERVER = 'https://ctamap.fly.dev';
const BOARD_ID_RE = /^[a-z0-9-]{1,32}$/;
const MARK_RE = /CTABOARD-BUILD:([A-Za-z0-9_]{1,48}):(generic|setup);/;
const ESP32S3_CHIP_ID = 9;

// ---- settings (must match config::to_json in firmware-s3/ctaboard/src/config.cpp) ----

// The firmware's defaults (ctaboard.ino), tuned for the P3 panel the boards use.
const PANEL_DEFAULTS = {
  rotation: 0, curve: 2, night_curve: 3, hw_dim: true, status_led: 2, tls_verify: true,
  clk_phase: false, double_buffer: true, color_order: 'RGB', knob_reverse: false,
};
const FIELDS = ['networks', 'url', 'board_id', 'token', 'rotation', 'curve', 'night_curve', 'hw_dim', 'status_led',
  'tls_verify', 'clk_phase', 'double_buffer', 'color_order', 'knob_reverse', 'setup_name', 'setup_pass'];

function boardConfig({ id, token, url = DEFAULT_SERVER, networks = [], setupName = '', setupPass = '', panel = {} }) {
  const c = { networks, url, board_id: id, token, ...PANEL_DEFAULTS, ...panel, setup_name: setupName, setup_pass: setupPass };
  return JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, c[k]])));
}

// "ssid=password" (password may be empty for an open network); WiFi limits as on the setup page.
function parseWifi(s) {
  const i = s.indexOf('=');
  const ssid = i < 0 ? s : s.slice(0, i);
  const pass = i < 0 ? '' : s.slice(i + 1);
  if (!ssid || Buffer.byteLength(ssid) > 32) throw new Error(`--wifi ${s}: the network name must be 1-32 bytes`);
  if (pass && (pass.length < 8 || pass.length > 63)) throw new Error(`--wifi ${ssid}: WiFi passwords are 8-63 characters (empty for an open network)`);
  return [ssid, pass];
}

// Setup network name and WPA2 password, from an alphabet without look-alikes.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomText(n, rand = crypto.randomBytes) {
  const lim = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < n) for (const x of rand(n)) if (x < lim && out.length < n) out += ALPHABET[x % ALPHABET.length];
  return out;
}
const setupNetwork = (rand) => ({ name: `Board-${randomText(4, rand).toUpperCase()}`, pass: randomText(10, rand) });

// ---- the build ----

// Partition table at 0x8000 of a merged image (esp_partition_info_t, 32 bytes each).
function partitions(img) {
  const out = [];
  for (let at = 0x8000; at + 32 <= img.length && at < 0x9000; at += 32) {
    if (img[at] !== 0xaa || img[at + 1] !== 0x50) break; // end (0xFF) or the MD5 entry (0xEB 0xEB)
    out.push({
      type: img[at + 2], subtype: img[at + 3], offset: img.readUInt32LE(at + 4), size: img.readUInt32LE(at + 8),
      label: img.toString('latin1', at + 12, at + 28).replace(/\0.*$/s, ''),
    });
  }
  return out;
}

// Where an ESP32 app image starting at `off` ends: the header, its segments,
// the checksum padded to 16 bytes, and the SHA-256 when appended
// (esp_image_format.h).
function appImageEnd(img, off) {
  const segments = img[off + 1];
  let p = off + 24;
  for (let i = 0; i < segments; i++) {
    if (p + 8 > img.length) throw new Error('the app image is cut short');
    p += 8 + img.readUInt32LE(p + 4);
  }
  p = off + Math.ceil((p - off + 1) / 16) * 16;
  if (img[off + 23] === 1) p += 32;
  if (p > img.length) throw new Error('the app image is cut short');
  return p;
}

// Checks a merged image (bootloader + partition table + app, as the CI
// builds it) and returns what flashing needs: its version, the NVS
// partition the settings go in, and where the app ends. arduino-esp32 pads
// the merged image with 0xFF to the whole 8 MB, past the TinyUF2
// recovery loader at 0x410000: only the part up to the app's end is flashed,
// so that loader (and the rest of flash) stays.
function inspectMerged(img) {
  if (!Buffer.isBuffer(img) || img.length < 0x10000 + 64 || img[0] !== 0xe9) {
    throw new Error('not a merged image: use ctaboard.ino.merged.bin (the CI artifact has it)');
  }
  if (img.readUInt16LE(12) !== ESP32S3_CHIP_ID) throw new Error('not built for the ESP32-S3 (pick Adafruit MatrixPortal ESP32-S3)');
  const parts = partitions(img);
  const nvs = parts.find((p) => p.type === 1 && p.subtype === 2);
  const slots = parts.filter((p) => p.type === 0 && (p.subtype === 0x10 || p.subtype === 0x11));
  if (!nvs) throw new Error('no partition table with an NVS partition at 0x8000');
  if (slots.length < 2) throw new Error('the partition table has no two OTA app slots: build with PartitionScheme=tinyuf2');
  if (img[slots[0].offset] !== 0xe9) throw new Error(`no app image at ${hex(slots[0].offset)}`);
  const end = appImageEnd(img, slots[0].offset);
  if (end - slots[0].offset > slots[0].size) throw new Error('the app is bigger than its slot');
  const m = img.toString('latin1').match(MARK_RE);
  if (!m) throw new Error('not a CTA board build (no build mark)');
  if (m[2] === 'setup') throw new Error('built with secrets.h: use the generic (CI) build');
  if (!/^[0-9a-f]{7,40}$/.test(m[1])) throw new Error(`build ${m[1]} isn't from a clean commit: use the CI build`);
  return { version: m[1], nvs: { offset: nvs.offset, size: nvs.size }, end };
}

// The image up to the app's end, in pieces around the NVS partition, plus
// the settings in it: one esptool pass, with no piece overwriting another.
function flashPlan(img, nvsImage, nvs, end) {
  if (nvsImage.length !== nvs.size) throw new Error(`the settings image is ${nvsImage.length} bytes; the NVS partition is ${nvs.size}`);
  const after = nvs.offset + nvs.size;
  return [
    { offset: 0, data: img.subarray(0, nvs.offset), name: 'bootloader + partition table' },
    { offset: nvs.offset, data: nvsImage, name: 'settings' },
    { offset: after, data: img.subarray(after, end), name: 'boot slot + app' },
  ].filter((p) => p.data.length);
}

const hex = (n) => '0x' + n.toString(16);

// ---- tools ----

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

// esptool's command: `esptool` (v5), `esptool.py` (v4), or the module.
function findEsptool() {
  for (const [cmd, pre] of [['esptool', []], ['esptool.py', []], ['python3', ['-m', 'esptool']], ['python', ['-m', 'esptool']]]) {
    const r = run(cmd, [...pre, 'version']);
    if (r.status === 0) return { cmd, pre };
  }
  return null;
}

function findNvsGen() {
  for (const py of ['python3', 'python']) {
    const r = run(py, ['-m', 'esp_idf_nvs_partition_gen', '--help']);
    if (r.status === 0) return py;
  }
  return null;
}

// The settings as an NVS image (namespace "ctaboard", key "cfg": what
// Preferences reads in device.cpp nvs_get).
function buildNvs(py, cfgJson, size, dir) {
  const cfgFile = path.join(dir, 'cfg.json');
  const csv = path.join(dir, 'nvs.csv');
  const out = path.join(dir, 'nvs.bin');
  fs.writeFileSync(cfgFile, cfgJson, { mode: 0o600 });
  fs.writeFileSync(csv, `key,type,encoding,value\nctaboard,namespace,,\ncfg,file,string,${cfgFile}\n`);
  const r = run(py, ['-m', 'esp_idf_nvs_partition_gen', 'generate', csv, out, hex(size)]);
  if (r.status !== 0) throw new Error(`building the settings image failed:\n${r.stdout}${r.stderr}`);
  return fs.readFileSync(out);
}

// The CI build to flash: the artifact for the server's stable build if CI
// still has it, else the newest successful build on main.
function downloadBuild(stable, dir) {
  if (run('gh', ['--version']).status !== 0) throw new Error('no GitHub CLI (gh): install it, or pass --firmware <ctaboard.ino.merged.bin>');
  const list = run('gh', ['run', 'list', '-R', REPO, '-w', WORKFLOW, '-b', 'main', '-s', 'success', '-L', '30', '--json', 'databaseId,headSha']);
  if (list.status !== 0) throw new Error(`gh run list failed: ${list.stderr.trim()}`);
  const runs = JSON.parse(list.stdout);
  if (!runs.length) throw new Error('no successful firmware build on main yet');
  const pick = (stable && runs.find((r) => r.headSha.startsWith(stable))) || runs[0];
  const dl = run('gh', ['run', 'download', String(pick.databaseId), '-R', REPO, '-D', dir]);
  if (dl.status !== 0) throw new Error(`gh run download failed: ${dl.stderr.trim()}`);
  const found = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.merged.bin')) found.push(p); } })(dir);
  if (!found.length) throw new Error(`run ${pick.databaseId} has no merged image (builds from before this script only have the app)`);
  return { file: found[0], sha: pick.headSha };
}

// ---- server ----

function controlApi(server, control) {
  const base = `${server.replace(/\/$/, '')}/board/${control}/`;
  return async (p, opts = {}) => {
    let r;
    try {
      r = await fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    } catch (e) {
      throw new Error(`can't reach ${server} (${(e.cause && e.cause.code) || e.message}); check --server`);
    }
    if (r.status === 404 && p === 'api/boards') throw new Error(`${server} doesn't know that control path; check BOARD_CONTROL_PATH`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${opts.method || 'GET'} ${p}: ${body.detail || body.err || `HTTP ${r.status}`}`);
    return body;
  };
}

// ---- the label ----

async function labelHtml({ id, label, setupName, setupPass, ownerUrl }) {
  let QRCode;
  try { QRCode = require('qrcode'); } catch (e) { throw new Error('the qrcode package is missing: run npm install'); }
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  // WiFi QR text (phones join from the camera); ; , : \ " escaped per the format.
  const wq = (s) => s.replace(/([\\;,:"])/g, '\\$1');
  const wifiQr = `WIFI:T:WPA;S:${wq(setupName)};P:${wq(setupPass)};;`;
  const svg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  const [wifiSvg, ownerSvg] = await Promise.all([svg(wifiQr), ownerUrl ? svg(ownerUrl) : null]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(label || id)} label</title><style>
body{font:14px/1.35 -apple-system,system-ui,sans-serif;margin:24px;color:#111}
.label{display:flex;gap:28px;border:1px dashed #999;padding:16px;width:max-content}
.qr{width:150px}.qr svg{width:150px;height:150px}.qr b{display:block;margin:6px 0 2px}
code{font-size:13px;white-space:nowrap}@media print{body{margin:0}.label{border:0}.hint{display:none}}
</style></head><body>
<p class="hint">Board <b>${esc(id)}</b>${label ? ` (${esc(label)})` : ''}. Print and stick on the back. The owner link is a secret: anyone with it controls this board.</p>
<div class="label">
<div class="qr">${wifiSvg}<b>1. Set up WiFi</b>Scan to join <code>${esc(setupName)}</code><br>Password <code>${esc(setupPass)}</code></div>
${ownerSvg ? `<div class="qr">${ownerSvg}<b>2. Your board</b>Scan to choose its station and screens</div>` : ''}
</div></body></html>
`;
}

// ---- main ----

const USAGE = `node scripts/setup-board.js --id <board-id> [options]

  --id <id>             board ID (a-z, 0-9, -)
  --label <name>        a name for people, shown on the control page
  --from <id>           settings to copy for a new board (default: home)
  --shared              no key of its own: the shared BOARD_TOKEN (your own boards)
  --rekey               give a board that already has a key a new one (the old token stops working)
  --wifi "ssid=pass"    save a network (repeatable); without it, WiFi is set on the board's setup network
  --firmware <file>     ctaboard.ino.merged.bin to flash (default: the CI build, via gh)
  --port <port>         serial port (default: esptool finds it)
  --server <url>        default ${DEFAULT_SERVER}
  --control <path>      the control path (default: $BOARD_CONTROL_PATH)
  --token <token>       with --shared: the shared token (default: $BOARD_TOKEN)
  --out <dir>           where the label goes (default: ~/board-labels, outside the repo)
  --dry-run             build everything, but don't change the server or flash
  --yes                 don't wait for Enter before flashing`;

async function main(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      id: { type: 'string' }, label: { type: 'string' }, from: { type: 'string', default: 'home' },
      shared: { type: 'boolean' }, rekey: { type: 'boolean' }, wifi: { type: 'string', multiple: true, default: [] },
      firmware: { type: 'string' }, port: { type: 'string' }, server: { type: 'string', default: DEFAULT_SERVER },
      control: { type: 'string' }, token: { type: 'string' }, out: { type: 'string', default: path.join(os.homedir(), 'board-labels') },
      'dry-run': { type: 'boolean' }, yes: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (o.help || !o.id) { console.log(USAGE); return o.help ? 0 : 2; }
  if (!BOARD_ID_RE.test(o.id)) throw new Error('--id must be 1-32 characters of a-z, 0-9, -');
  const dry = !!o['dry-run'];
  const control = o.control || process.env.BOARD_CONTROL_PATH;
  if (!control) throw new Error('set BOARD_CONTROL_PATH (or --control): the script adds the board and its key on the server');
  const sharedToken = o.shared ? (o.token || process.env.BOARD_TOKEN) : null;
  if (o.shared && !sharedToken) throw new Error('--shared needs the shared token: set BOARD_TOKEN or pass --token');
  const networks = o.wifi.map(parseWifi);
  if (networks.length && !o.shared) {
    console.warn('! --wifi on a board with its own key: its owner can read that password out of flash. Run setup again without --wifi before it ships.');
  }

  // Tools first, so nothing changes on the server if one is missing.
  const esptool = findEsptool();
  const py = findNvsGen();
  if (!esptool || !py) throw new Error('needs esptool and the NVS image tool: pip install esptool esp-idf-nvs-partition-gen');
  const api = controlApi(o.server, control);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'board-setup-'));
  try {
    // 1. The build.
    let file = o.firmware;
    if (!file) {
      let stable = null;
      try { stable = (await api('api/firmware')).channels.stable; } catch (e) { console.warn(`! couldn't read the stable build: ${e.message}`); }
      const got = downloadBuild(stable, path.join(tmp, 'build'));
      file = got.file;
      console.log(`Build: CI ${got.sha.slice(0, 7)}${stable && got.sha.startsWith(stable) ? ' (stable)' : ' (newest on main)'}`);
    }
    const img = fs.readFileSync(file);
    const { version, nvs, end } = inspectMerged(img);
    console.log(`Build ${version}: ${end} bytes to flash; settings go at ${hex(nvs.offset)} (${nvs.size} bytes)`);

    // 2. The server: the board and its key.
    const boards = await api('api/boards');
    const known = boards.find((b) => b.id === o.id);
    if (!known) console.log(`Server: adding board ${o.id} (a copy of ${o.from})`);
    if (known && known.link && !o.shared && !o.rekey) {
      throw new Error(`${o.id} already has its own key. --rekey gives it a new one (a board still running the old token stops connecting until it's set up again).`);
    }
    let token = sharedToken;
    let ownerUrl = null;
    if (dry) {
      if (!o.shared) token = 'dry-run-placeholder-token';
      console.log('Dry run: the server is not changed.');
    } else {
      if (!known) await api('api/boards', { method: 'POST', body: JSON.stringify({ id: o.id, from: o.from, label: o.label ?? '' }) });
      else if (o.label != null) await api(`api/state?b=${encodeURIComponent(o.id)}`, { method: 'POST', body: JSON.stringify({ label: o.label }) });
      if (o.shared) {
        if (known && known.link) await api(`api/boards/key?b=${encodeURIComponent(o.id)}`, { method: 'DELETE' });
      } else {
        const k = await api(`api/boards/key?b=${encodeURIComponent(o.id)}`, { method: 'POST' });
        token = k.token;
        ownerUrl = `${o.server.replace(/\/$/, '')}/board/c/${k.link}/`;
      }
    }

    // 3. Settings.
    const net = setupNetwork();
    const cfg = boardConfig({ id: o.id, token, url: o.server, networks, setupName: net.name, setupPass: net.pass });
    const nvsImage = buildNvs(py, cfg, nvs.size, tmp);
    const plan = flashPlan(img, nvsImage, nvs, end);

    // 4. Flash.
    const args = [...esptool.pre, '--chip', 'esp32s3', ...(o.port ? ['--port', o.port] : []), '--baud', '921600',
      'write_flash', ...plan.flatMap((p) => { const f = path.join(tmp, `part-${hex(p.offset)}.bin`); fs.writeFileSync(f, p.data); return [hex(p.offset), f]; })];
    console.log(`Flash: ${plan.map((p) => `${p.name} at ${hex(p.offset)}`).join(', ')}`);
    if (dry) {
      console.log(`Dry run: would run ${esptool.cmd} ${args.join(' ')}`);
    } else {
      if (!o.yes) {
        await ask('Put the board in upload mode (hold BOOT, tap RESET, release BOOT), then press Enter. ');
      }
      const r = spawnSync(esptool.cmd, args, { stdio: 'inherit' });
      if (r.status !== 0) {
        throw new Error(`flashing failed. The server already has the board${o.shared ? '' : ' and its new key: run again with --rekey'}.`);
      }
      console.log('Flashed. Press RESET on the board.');
    }

    // 5. The label.
    fs.mkdirSync(o.out, { recursive: true });
    const labelFile = path.join(o.out, `${o.id}-label.html`);
    fs.writeFileSync(labelFile, await labelHtml({ id: o.id, label: o.label, setupName: net.name, setupPass: net.pass, ownerUrl }), { mode: 0o600 });
    console.log(`\nSetup network: ${net.name} / ${net.pass}`);
    if (ownerUrl) console.log(`Owner link:    ${ownerUrl}`);
    console.log(`Label:         ${labelFile}`);
    console.log(networks.length ? `It joins ${networks[0][0]} after RESET.` : 'After RESET it shows SETUP WIFI and its network name: join it to enter WiFi.');
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true }); // the token was in here
  }
}

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, () => { rl.close(); resolve(); }));
}

module.exports = { boardConfig, parseWifi, randomText, setupNetwork, partitions, appImageEnd, inspectMerged, flashPlan, labelHtml, PANEL_DEFAULTS, FIELDS };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`setup-board: ${e.message}`); process.exitCode = 1; });
}
