// Setting up an S3 board (firmware-s3/README.md, "Setting up a board"): the
// pieces both setup tools share, scripts/setup-board.js (Node, esptool) and
// the control page's Set up a board (the browser, Web Serial):
//   - the board's settings JSON (must match config::to_json in
//     firmware-s3/ctaboard/src/config.cpp),
//   - the settings as an NVS partition image (namespace "ctaboard", key
//     "cfg": what Preferences reads in device.cpp nvs_get), byte for byte
//     what ESP-IDF's nvs_partition_gen makes,
//   - checking a merged image (bootloader + partition table + app) and the
//     flash plan: everything up to the app's end, the settings in their
//     partition, never the 0xFF padding (TinyUF2 sits at 0x410000),
//   - the label's text and layout (the caller makes the QR codes).
// Plain Uint8Array / DataView, no Node APIs: the server also serves this
// file to the control page as is (window.BoardSetup).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BoardSetup = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const BOARD_ID_RE = /^[a-z0-9-]{1,32}$/;
  const MARK_RE = /CTABOARD-BUILD:([A-Za-z0-9_]{1,48}):(generic|setup);/;
  const ESP32S3_CHIP_ID = 9;
  const enc = new TextEncoder();
  const hex = (n) => '0x' + n.toString(16);
  const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
  const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  // ---- settings ----

  // The firmware's defaults (ctaboard.ino), tuned for the P3 panel the boards use.
  const PANEL_DEFAULTS = {
    rotation: 0, curve: 2, night_curve: 3, hw_dim: true, status_led: 2, tls_verify: true,
    clk_phase: false, double_buffer: true, color_order: 'RGB', knob_reverse: false,
  };
  const FIELDS = ['networks', 'url', 'board_id', 'token', 'rotation', 'curve', 'night_curve', 'hw_dim', 'status_led',
    'tls_verify', 'clk_phase', 'double_buffer', 'color_order', 'knob_reverse', 'setup_name', 'setup_pass'];

  const DEFAULT_URL = 'https://ctamap.fly.dev';
  function boardConfig({ id, token, url = DEFAULT_URL, networks = [], setupName = '', setupPass = '', panel = {} }) {
    const c = { networks, url, board_id: id, token, ...PANEL_DEFAULTS, ...panel, setup_name: setupName, setup_pass: setupPass };
    return JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, c[k]])));
  }

  // A WiFi network as the setup page allows it: [ssid, password].
  function checkWifi(ssid, pass = '') {
    if (!ssid || enc.encode(ssid).length > 32) throw new Error(`WiFi ${ssid || '(no name)'}: the network name must be 1-32 bytes`);
    if (pass && (pass.length < 8 || pass.length > 63)) throw new Error(`WiFi ${ssid}: passwords are 8-63 characters (empty for an open network)`);
    return [ssid, pass];
  }

  // Setup network name and WPA2 password, from an alphabet without look-alikes.
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  const cryptoRand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  function randomText(n, rand = cryptoRand) {
    const lim = 256 - (256 % ALPHABET.length);
    let out = '';
    while (out.length < n) for (const x of rand(n)) if (x < lim && out.length < n) out += ALPHABET[x % ALPHABET.length];
    return out;
  }
  const setupNetwork = (rand) => ({ name: `Board-${randomText(4, rand).toUpperCase()}`, pass: randomText(10, rand) });

  // ---- the settings image (ESP-IDF NVS, format version 2) ----

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  // zlib.crc32(data, prev), as nvs_partition_gen calls it (prev 0xFFFFFFFF).
  function crc32(data, prev = 0) {
    let c = (prev ^ 0xffffffff) >>> 0;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const PAGE = 4096, ENTRY = 32, FIRST_ENTRY = 64, MAX_ENTRIES = 126;
  const ACTIVE = 0xfffffffe, VERSION2 = 0xfe, U8 = 0x01, SZ = 0x21, CHUNK_ANY = 0xff;

  // One NVS page holding namespace `ns` (index 1) and the string `key` =
  // `value` (stored with its NUL), then empty pages to `size` (the last page
  // stays empty: NVS keeps one free).
  function nvsImage({ ns = 'ctaboard', key = 'cfg', value, size }) {
    if (size % PAGE || size < 3 * PAGE) throw new Error(`the NVS partition must be a multiple of 4096 bytes, at least 12288 (got ${size})`);
    const data = enc.encode(value + '\0');
    if (data.length > 4000) throw new Error(`the settings are ${data.length} bytes; NVS strings hold at most 4000`);
    const img = new Uint8Array(size).fill(0xff);
    const view = dv(img);
    // Page 0's header: state, sequence number, version, CRC of bytes 4-27.
    view.setUint32(0, ACTIVE, true);
    view.setUint32(4, 0, true);
    img[8] = VERSION2;
    view.setUint32(28, crc32(img.subarray(4, 28), 0xffffffff), true);
    let n = 0; // entries written
    const bitmap = img.subarray(32, 64);
    const mark = (count) => { for (let i = 0; i < count; i++, n++) bitmap[(n * 2) >> 3] &= ~(1 << ((n * 2) & 7)); };
    const entry = (nsIdx, type, span, name, fill) => {
      const e = new Uint8Array(ENTRY).fill(0xff);
      e[0] = nsIdx; e[1] = type; e[2] = span; e[3] = CHUNK_ANY;
      e.fill(0, 8, 24);
      e.set(enc.encode(name).subarray(0, 15), 8);
      fill(e, dv(e));
      const crcData = new Uint8Array(28);
      crcData.set(e.subarray(0, 4), 0);
      crcData.set(e.subarray(8, 32), 4);
      dv(e).setUint32(4, crc32(crcData, 0xffffffff), true);
      return e;
    };
    // The namespace: a U8 entry in namespace 0 whose value is its index.
    img.set(entry(0, U8, 1, ns, (e) => { e[24] = 1; }), FIRST_ENTRY + n * ENTRY);
    mark(1);
    // The string: its header entry (size, data CRC), then the bytes.
    const dataEntries = Math.ceil(data.length / ENTRY);
    if (n + 1 + dataEntries >= MAX_ENTRIES) throw new Error('the settings don\'t fit one NVS page');
    img.set(entry(1, SZ, dataEntries + 1, key, (e, v) => {
      v.setUint16(24, data.length, true);
      v.setUint32(28, crc32(data, 0xffffffff), true);
    }), FIRST_ENTRY + n * ENTRY);
    mark(1);
    img.set(data, FIRST_ENTRY + n * ENTRY);
    mark(dataEntries);
    return img;
  }

  // ---- the build ----

  // Partition table at 0x8000 of a merged image (esp_partition_info_t, 32 bytes each).
  function partitions(img) {
    img = u8(img);
    const v = dv(img), out = [];
    for (let at = 0x8000; at + 32 <= img.length && at < 0x9000; at += 32) {
      if (img[at] !== 0xaa || img[at + 1] !== 0x50) break; // end (0xFF) or the MD5 entry (0xEB 0xEB)
      let label = '';
      for (let i = at + 12; i < at + 28 && img[i]; i++) label += String.fromCharCode(img[i]);
      out.push({ type: img[at + 2], subtype: img[at + 3], offset: v.getUint32(at + 4, true), size: v.getUint32(at + 8, true), label });
    }
    return out;
  }

  // Where an ESP32 app image starting at `off` ends: the header, its segments,
  // the checksum padded to 16 bytes, and the SHA-256 when appended
  // (esp_image_format.h).
  function appImageEnd(img, off) {
    img = u8(img);
    const v = dv(img);
    const segments = img[off + 1];
    let p = off + 24;
    for (let i = 0; i < segments; i++) {
      if (p + 8 > img.length) throw new Error('the app image is cut short');
      p += 8 + v.getUint32(p + 4, true);
    }
    p = off + Math.ceil((p - off + 1) / 16) * 16;
    if (img[off + 23] === 1) p += 32;
    if (p > img.length) throw new Error('the app image is cut short');
    return p;
  }

  // The build mark (ctaboard.ino BUILD_MARK) in a span of bytes, or null.
  function buildMark(img, from = 0, to = img.length) {
    img = u8(img);
    const needle = enc.encode('CTABOARD-BUILD:');
    outer: for (let i = from; i + needle.length < to; i++) {
      for (let k = 0; k < needle.length; k++) if (img[i + k] !== needle[k]) continue outer;
      let s = '';
      for (let j = i; j < Math.min(to, i + 80); j++) { s += String.fromCharCode(img[j]); if (img[j] === 59) break; } // to the ';'
      const m = MARK_RE.exec(s);
      if (m) return { version: m[1], kind: m[2] };
    }
    return null;
  }

  // Checks a merged image (bootloader + partition table + app, as the CI
  // builds it) and returns what flashing needs: its version, the NVS
  // partition the settings go in, the app slot, and where the app ends.
  // arduino-esp32 pads the merged image with 0xFF to the whole 8 MB, past the
  // TinyUF2 recovery loader at 0x410000: only the part up to the app's end
  // is flashed, so that loader (and the rest of flash) stays. Works on the
  // whole image or on just its first `end` bytes.
  function inspectMerged(img) {
    img = u8(img);
    if (img.length < 0x10000 + 64 || img[0] !== 0xe9) {
      throw new Error('not a merged image: use ctaboard.ino.merged.bin (the CI artifact has it)');
    }
    if (dv(img).getUint16(12, true) !== ESP32S3_CHIP_ID) throw new Error('not built for the ESP32-S3 (pick Adafruit MatrixPortal ESP32-S3)');
    const parts = partitions(img);
    const nvs = parts.find((p) => p.type === 1 && p.subtype === 2);
    const slots = parts.filter((p) => p.type === 0 && (p.subtype === 0x10 || p.subtype === 0x11));
    if (!nvs) throw new Error('no partition table with an NVS partition at 0x8000');
    if (slots.length < 2) throw new Error('the partition table has no two OTA app slots: build with PartitionScheme=tinyuf2');
    if (img[slots[0].offset] !== 0xe9) throw new Error(`no app image at ${hex(slots[0].offset)}`);
    const end = appImageEnd(img, slots[0].offset);
    if (end - slots[0].offset > slots[0].size) throw new Error('the app is bigger than its slot');
    const m = buildMark(img, slots[0].offset, end);
    if (!m) throw new Error('not a CTA board build (no build mark)');
    if (m.kind === 'setup') throw new Error('built with secrets.h: use the generic (CI) build');
    if (!/^[0-9a-f]{7,40}$/.test(m.version)) throw new Error(`build ${m.version} isn't from a clean commit: use the CI build`);
    return { version: m.version, nvs: { offset: nvs.offset, size: nvs.size }, app: { offset: slots[0].offset, size: slots[0].size }, end };
  }

  // The image up to the app's end, in pieces around the NVS partition, plus
  // the settings in it: one flashing pass, with no piece overwriting another.
  function flashPlan(img, nvsData, nvs, end) {
    img = u8(img);
    if (nvsData.length !== nvs.size) throw new Error(`the settings image is ${nvsData.length} bytes; the NVS partition is ${nvs.size}`);
    const after = nvs.offset + nvs.size;
    return [
      { offset: 0, data: img.subarray(0, nvs.offset), name: 'bootloader + partition table' },
      { offset: nvs.offset, data: nvsData, name: 'settings' },
      { offset: after, data: img.subarray(after, end), name: 'boot slot + app' },
    ].filter((p) => p.data.length);
  }

  // ---- the label ----

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  // WiFi QR text (phones join from the camera); ; , : \ " escaped per the format.
  const wq = (s) => s.replace(/([\\;,:"])/g, '\\$1');
  const wifiQrText = (name, pass) => `WIFI:T:WPA;S:${wq(name)};P:${wq(pass)};;`;

  const LABEL_CSS = `.label{display:flex;gap:28px;border:1px dashed #999;padding:16px;width:max-content;margin:0 0 16px;break-inside:avoid;font:14px/1.35 -apple-system,system-ui,sans-serif;color:#111;background:#fff}
.label .qr{width:150px}.label .qr svg{width:150px;height:150px;display:block}.label .qr b{display:block;margin:6px 0 2px}
.label code{font:13px ui-monospace,Menlo,monospace;color:#111;background:none;white-space:nowrap}.label .id{font-size:11px;color:#666;margin-top:6px}`;

  // One label's HTML (a <div class="label">). qr: { wifi, owner } SVG strings.
  function labelBody({ id, label, setupName, setupPass, ownerUrl }, qr) {
    return `<div class="label">
<div class="qr">${qr.wifi}<b>1. Set up WiFi</b>Scan to join <code>${esc(setupName)}</code><br>Password <code>${esc(setupPass)}</code></div>
${ownerUrl && qr.owner ? `<div class="qr">${qr.owner}<b>2. Your board</b>Scan to choose its station and screens<div class="id">${esc(label || id)}</div></div>` : ''}
</div>`;
  }

  // A printable page of labels. items: [{ id, label, setupName, setupPass, ownerUrl, qr }].
  function labelPage(items) {
    const title = items.length === 1 ? `${esc(items[0].label || items[0].id)} label` : `${items.length} board labels`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font:14px/1.35 -apple-system,system-ui,sans-serif;margin:24px;color:#111;background:#fff}
${LABEL_CSS}
@media print{body{margin:0}.label{border:0}.hint{display:none}}
</style></head><body>
<p class="hint">${items.length === 1 ? `Board <b>${esc(items[0].id)}</b>${items[0].label ? ` (${esc(items[0].label)})` : ''}. ` : ''}Print and stick on the back. An owner link is a secret: anyone with it controls that board.</p>
${items.map((it) => labelBody(it, it.qr)).join('\n')}
</body></html>
`;
  }

  return {
    BOARD_ID_RE, PANEL_DEFAULTS, FIELDS, boardConfig, checkWifi, randomText, setupNetwork,
    crc32, nvsImage, partitions, appImageEnd, buildMark, inspectMerged, flashPlan,
    wifiQrText, labelBody, labelPage, LABEL_CSS, hex,
  };
}));
