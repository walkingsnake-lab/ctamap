'use strict';
// Every glyph and icon in the packed firmware assets (assets.py, read by
// draw.glyph / glyph_row) decodes back to exactly the server's fonts and
// icons. Parity tests only cover glyphs their scenarios happen to draw.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { packFonts } = require('../../server/board/fonts');
const icons = require('../../server/board/icons');

const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(__dirname, '..'))})
from boardlib import assets, draw
fonts = {}
for name, d in assets.FONT_DATA.items():
    out = {}
    for cp in list(range(32, 256)) + list(range(assets.PUA, assets.PUA + 16)):
        o = draw.glyph(name, cp)
        if o < 0:
            continue
        h = d[o + 2]
        out[str(cp)] = [d[o], d[o + 1], h, d[o + 3] - 128, d[o + 4] - 128] + [draw.glyph_row(d, o, r) for r in range(h)]
    fonts[name] = out
icons = {k: ''.join(chr(c) for c in v) for k, v in assets.ICONS.items()}
pal = {chr(k): list(v) for k, v in assets.ICON_PALETTE.items()}
print(json.dumps({'fonts': fonts, 'icons': icons, 'pal': pal}))
`;

test('packed fonts and icons decode to the server data, every glyph', () => {
  const r = spawnSync('python3', ['-c', PY], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  const want = packFonts();
  assert.deepEqual(Object.keys(got.fonts).sort(), Object.keys(want).sort());
  for (const name of Object.keys(want)) {
    assert.equal(Object.keys(got.fonts[name]).length, Object.keys(want[name]).length, `${name}: glyph count`);
    for (const [cp, g] of Object.entries(want[name])) assert.deepEqual(got.fonts[name][cp], g, `${name} ${cp}`);
  }
  for (const [k, rows] of Object.entries(icons.ICONS)) assert.equal(got.icons[k], rows.join(''), `icon ${k}`);
  const hex = (v) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  for (const [k, v] of Object.entries(icons.PALETTE)) assert.deepEqual(got.pal[k], hex(v), `palette ${k}`);
});
