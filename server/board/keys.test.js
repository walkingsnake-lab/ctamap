'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createKeys } = require('./keys');

const quiet = { warn() {}, error() {} };

test('keys: only the hash is kept, and keys survive a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-keys-'));
  const k = createKeys({ dir, log: quiet });
  assert.equal(k.check('kitchen', 'x'), null); // no key: the shared token applies
  const { token, link } = k.issue('kitchen', 100);
  assert.equal(k.check('kitchen', token), true);
  assert.equal(k.check('kitchen', token + 'x'), false);
  assert.equal(k.check('kitchen', undefined), false);
  const file = fs.readFileSync(path.join(dir, 'board-keys.json'), 'utf8');
  assert.ok(!file.includes(token), 'the token itself is never stored');
  const again = createKeys({ dir, log: quiet });
  assert.equal(again.check('kitchen', token), true);
  assert.equal(again.idForLink(link), 'kitchen');
  assert.equal(again.idForLink('../../etc/passwd'), null);
  again.remove('kitchen');
  assert.equal(again.idForLink(link), null);
  assert.equal(again.check('kitchen', token), null);
});
