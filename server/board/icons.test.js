'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ICONS, PALETTE, ALERT_BANG, iconForCode } = require('./icons');

// Icon names the contract's wx.icon allows (docs/board/contract.md).
const CONTRACT_ICONS = ['sun', 'moon', 'pcloudy_day', 'pcloudy_night', 'cloudy', 'rain', 'ice', 'snow', 'storm', 'fog'];

test('icon set matches the contract', () => {
  assert.deepEqual(Object.keys(ICONS).sort(), [...CONTRACT_ICONS].sort());
});

test('every icon is 8x8 and uses only palette colors', () => {
  for (const [name, rows] of Object.entries(ICONS)) {
    assert.equal(rows.length, 8, name);
    for (const r of rows) {
      assert.equal(r.length, 8, `${name}: ${r}`);
      for (const c of r) if (c !== '.') assert.ok(PALETTE[c], `${name}: unknown color '${c}'`);
    }
  }
});

test('WMO codes map to the spec icons', () => {
  assert.equal(iconForCode(0, true), 'sun');
  assert.equal(iconForCode(0, false), 'moon');
  assert.equal(iconForCode(1, true), 'sun');
  assert.equal(iconForCode(1, false), 'moon');
  assert.equal(iconForCode(2, true), 'pcloudy_day');
  assert.equal(iconForCode(2, false), 'pcloudy_night');
  assert.equal(iconForCode(3, true), 'cloudy');
  assert.equal(iconForCode(45, true), 'fog');
  for (const c of [51, 53, 55, 61, 63, 65, 80, 81, 82]) assert.equal(iconForCode(c, true), 'rain', `code ${c}`);
  for (const c of [56, 57, 66, 67]) assert.equal(iconForCode(c, true), 'ice', `code ${c}`);
  for (const c of [71, 73, 75, 77, 85, 86]) assert.equal(iconForCode(c, true), 'snow', `code ${c}`);
  for (const c of [95, 96, 99]) assert.equal(iconForCode(c, true), 'storm', `code ${c}`);
});

test('transit alert "!" fits the 3x5 color block', () => {
  assert.equal(ALERT_BANG.length, 5);
  for (const r of ALERT_BANG) assert.equal(r.length, 3);
});
