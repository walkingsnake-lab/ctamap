const { buildSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcFiles = [
  'js/config.js',
  'js/map.js',
  'js/path-follow.js',
  'js/trains.js',
  'js/app.js',
  'js/alerts.js',
];

// Concatenate source files in load order
const combined = srcFiles
  .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'))
  .join('\n');

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });

// Write combined file so esbuild can process it
const tmpPath = path.join(__dirname, 'dist', '_combined.js');
fs.writeFileSync(tmpPath, combined);

buildSync({
  entryPoints: [tmpPath],
  outfile: path.join(__dirname, 'dist', 'bundle.min.js'),
  bundle: false,
  minify: true,
  sourcemap: true,
  target: ['es2020'],
});

// Clean up temp file
fs.unlinkSync(tmpPath);

const stat = fs.statSync(path.join(__dirname, 'dist', 'bundle.min.js'));
console.log(`dist/bundle.min.js — ${(stat.size / 1024).toFixed(1)} KB`);

// The LED board control page's Set up a board: esptool-js (flashing over
// Web Serial) and qrcode, as window.SetupTools. Served by the board router;
// loaded only when the setup dialog opens.
buildSync({
  entryPoints: [path.join(__dirname, 'server', 'board', 'setup-tools-entry.mjs')],
  outfile: path.join(__dirname, 'dist', 'setup-tools.min.js'),
  bundle: true,
  format: 'iife',
  globalName: 'SetupTools',
  platform: 'browser',
  minify: true,
  target: ['es2020'],
  logLevel: 'warning',
});
const st = fs.statSync(path.join(__dirname, 'dist', 'setup-tools.min.js'));
console.log(`dist/setup-tools.min.js — ${(st.size / 1024).toFixed(1)} KB`);
