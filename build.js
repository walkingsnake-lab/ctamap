const { buildSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcFiles = [
  'js/config.js',
  'js/map.js',
  'js/path-follow.js',
  'js/trains.js',
  'js/train-eta-ai.js',
  'js/app.js',
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
