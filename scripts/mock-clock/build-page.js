#!/usr/bin/env node
'use strict';
// Builds the live clock-face page: page.html with the board fonts, icons and
// faces.js inlined, so it runs on its own in a browser.
//   node scripts/mock-clock/build-page.js <out.html> [groups]
// groups: comma-separated (e.g. R4); default all.

const fs = require('fs');
const path = require('path');
const { packFonts } = require('../../server/board/fonts');
const icons = require('../../server/board/icons');
const { redLine } = require('./env');

const out = process.argv[2] || path.join(__dirname, 'clock-faces.html');
const groups = process.argv[3] ? process.argv[3].split(',') : null;
const env = { fonts: packFonts(), icons: { ICONS: icons.ICONS, PALETTE: icons.PALETTE }, redLine: redLine(), digitFonts: require('./digit-fonts.json'), bitmapDigits: require('./bitmap-digits.json') };
const html = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8')
  .replace('/*__ENV__*/null', () => JSON.stringify(env))
  .replace('/*__GROUPS__*/null', () => JSON.stringify(groups))
  .replace('/*__FACES__*/', () => ['faces.js', 'faces-r4.js', 'faces-r5.js', 'faces-r6.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n'));
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
