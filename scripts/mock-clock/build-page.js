#!/usr/bin/env node
'use strict';
// Builds the live clock-face page: page.html with the board fonts, icons and
// faces.js inlined, so it runs on its own in a browser.
//   node scripts/mock-clock/build-page.js <out.html>

const fs = require('fs');
const path = require('path');
const { packFonts } = require('../../server/board/fonts');
const icons = require('../../server/board/icons');

const out = process.argv[2] || path.join(__dirname, 'clock-faces.html');
const env = { fonts: packFonts(), icons: { ICONS: icons.ICONS, PALETTE: icons.PALETTE } };
const html = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8')
  .replace('/*__ENV__*/null', () => JSON.stringify(env))
  .replace('/*__FACES__*/', () => fs.readFileSync(path.join(__dirname, 'faces.js'), 'utf8'));
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
