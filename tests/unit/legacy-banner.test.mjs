// Unit test dell'avviso "vecchia icona" (js/legacy-banner.js). Uso: node --test tests/unit/legacy-banner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripFromV1, shouldShow, installHelp } from '../../js/legacy-banner.js';

test('toglie solo from=v1 e lascia gli altri parametri identici', () => {
  assert.deepEqual(stripFromV1('?from=v1'), { fromV1: true, search: '' });
  assert.deepEqual(stripFromV1('?emulator&from=v1&as=bob'), { fromV1: true, search: '?emulator&as=bob' });
  assert.deepEqual(stripFromV1('?invite=abc'), { fromV1: false, search: '?invite=abc' });
  assert.deepEqual(stripFromV1(''), { fromV1: false, search: '' });
  assert.equal(stripFromV1('?from=v10').fromV1, false, 'solo il valore esatto');
  assert.equal(stripFromV1('?from=v2').fromV1, false);
});

test('compare solo arrivando dalla v1, non in standalone, non dopo "Ho capito", non se già installata', () => {
  const base = { fromV1: true, standalone: false, dismissed: false, installed: false };
  assert.equal(shouldShow(base), true);
  assert.equal(shouldShow({ ...base, fromV1: false }), false);
  assert.equal(shouldShow({ ...base, standalone: true }), false);
  assert.equal(shouldShow({ ...base, dismissed: true }), false);
  assert.equal(shouldShow({ ...base, installed: true }), false);
});

test('istruzioni: iPhone "Condividi → Aggiungi alla schermata Home", Android menu ⋮', () => {
  assert.match(installHelp('ios'), /Condividi.*Aggiungi alla schermata Home/);
  assert.match(installHelp('android'), /⋮.*Installa app/);
  for (const k of ['ios', 'android']) assert.match(installHelp(k), /lucsor\.github\.io\/garageos-v2/);
});
