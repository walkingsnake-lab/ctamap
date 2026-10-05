#!/usr/bin/env node
'use strict';
// Builds what goes on the board's CIRCUITPY drive into firmware/build/:
// code.py, and boardlib compiled to .mpy (the M4 runs out of memory
// compiling the larger .py files itself).
//
//   node scripts/build-firmware.js [path/to/mpy-cross]
//
// mpy-cross must come from the same CircuitPython major version as the board
// (MicroPython's won't do): https://adafruit-circuit-python.s3.amazonaws.com/index.html?prefix=bin/mpy-cross/
// The path can also be set with MPY_CROSS; the default is mpy-cross on PATH.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FIRMWARE = path.join(__dirname, '..', 'firmware');
const OUT = path.join(FIRMWARE, 'build');

function build(mpyCross) {
  const v = spawnSync(mpyCross, ['--version'], { encoding: 'utf8' });
  if (v.error || v.status !== 0) throw new Error(`can't run ${mpyCross}; pass the path to CircuitPython's mpy-cross`);
  if (!/CircuitPython/.test(v.stdout)) throw new Error(`${mpyCross} is not CircuitPython's mpy-cross: ${v.stdout.trim()}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'boardlib'), { recursive: true });
  fs.copyFileSync(path.join(FIRMWARE, 'code.py'), path.join(OUT, 'code.py'));
  const files = [];
  for (const name of fs.readdirSync(path.join(FIRMWARE, 'boardlib')).filter((f) => f.endsWith('.py')).sort()) {
    const src = path.join(FIRMWARE, 'boardlib', name);
    if (name === '__init__.py') {
      fs.copyFileSync(src, path.join(OUT, 'boardlib', name));
      continue;
    }
    const dest = path.join(OUT, 'boardlib', name.replace(/\.py$/, '.mpy'));
    const r = spawnSync(mpyCross, ['-s', `boardlib/${name}`, '-o', dest, src], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`mpy-cross failed on ${name}:\n${r.stderr}`);
    files.push([path.basename(dest), fs.statSync(dest).size]);
  }
  return { version: v.stdout.trim(), files };
}

if (require.main === module) {
  try {
    const { version, files } = build(process.argv[2] || process.env.MPY_CROSS || 'mpy-cross');
    console.log(version);
    for (const [name, size] of files) console.log(`  boardlib/${name.padEnd(12)} ${size} bytes`);
    console.log(`Copy everything in ${path.relative(process.cwd(), OUT)}/ to CIRCUITPY, and delete any boardlib/*.py there except __init__.py (a .py wins over its .mpy).`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { build, OUT };
