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
// The control page's Set up a board does the same from Chrome, with
// nothing to install; this script is the fallback (and for scripting).
//
// Needs: Python with `pip install esptool`; the GitHub CLI (gh) unless
// --firmware is given; BOARD_CONTROL_PATH (and
// BOARD_TOKEN with --shared) in the environment, or --control / --token.
// The board's token is never written to disk outside a temp folder that's
// deleted afterwards. --dry-run does everything except changing the server
// and flashing (a placeholder token goes into the image).

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { parseArgs } = require('util');

const REPO = 'walkingsnake-lab/ctamap';
const WORKFLOW = 'firmware-s3.yml';
const DEFAULT_SERVER = 'https://ctamap.fly.dev';
const { BOARD_ID_RE } = require('../server/board/setup-image');

// The settings, the settings image, the build checks and the label are
// shared with the control page's Set up a board (server/board/setup-image.js).
const S = require('../server/board/setup-image');
const { boardConfig, randomText, setupNetwork, partitions, appImageEnd, inspectMerged, flashPlan, PANEL_DEFAULTS, FIELDS, hex } = S;

// "ssid=password" (password may be empty for an open network); WiFi limits as on the setup page.
function parseWifi(s) {
  const i = s.indexOf('=');
  try { return S.checkWifi(i < 0 ? s : s.slice(0, i), i < 0 ? '' : s.slice(i + 1)); }
  catch (e) { throw new Error(`--wifi ${s}: ${e.message.replace(/^WiFi [^:]*: /, '')}`); }
}

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

// The settings as an NVS image (namespace "ctaboard", key "cfg": what
// Preferences reads in device.cpp nvs_get), the same bytes ESP-IDF's
// nvs_partition_gen makes.
const buildNvs = (cfgJson, size) => Buffer.from(S.nvsImage({ value: cfgJson, size }));

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
  const svg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  const [wifi, owner] = await Promise.all([svg(S.wifiQrText(setupName, setupPass)), ownerUrl ? svg(ownerUrl) : null]);
  return S.labelPage([{ id, label, setupName, setupPass, ownerUrl, qr: { wifi, owner } }]);
}

// ---- main ----

const USAGE = `node scripts/setup-board.js --id <board-id> [options]

  --id <id>             board ID (a-z, 0-9, -)
  --label <name>        a name for people, shown on the control page
  --from <id>           settings to copy for a new board (default: home)
  --shared              no key of its own: the shared BOARD_TOKEN (your own boards)
  --rekey               give a board that already has a key a new one (the old token stops working)
  --wifi "ssid=pass"    save a network (repeatable); without it, WiFi is set on the board's setup network
  --cols 64|128         LEDs across: 64 for one panel (default), 128 for two chained
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
      cols: { type: 'string', default: '64' },
      'dry-run': { type: 'boolean' }, yes: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (o.help || !o.id) { console.log(USAGE); return o.help ? 0 : 2; }
  if (!BOARD_ID_RE.test(o.id)) throw new Error('--id must be 1-32 characters of a-z, 0-9, -');
  if (o.cols !== '64' && o.cols !== '128') throw new Error('--cols must be 64 (one panel) or 128 (two)');
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
  if (!esptool) throw new Error('needs esptool: pip install esptool');
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
    const cfg = boardConfig({ id: o.id, token, url: o.server, networks, setupName: net.name, setupPass: net.pass, panel: { cols: Number(o.cols) } });
    const nvsImage = buildNvs(cfg, nvs.size);
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
