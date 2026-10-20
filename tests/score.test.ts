import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialScores,
  updateScores,
  getPercentages,
  getLeader,
  type VoteEvent,
} from '../src/core/score.ts';
import { createStore } from '../src/core/store.ts';
test('inicia zerado e empatado, com barras vazias', () => {
  const s = initialScores();
  assert.deepEqual(s, { a: 0, b: 0 });
  assert.equal(getLeader(s), null);
  assert.deepEqual(getPercentages(s), { a: 0, b: 0 });
});
test('incrementa cada lado sem mutar o estado anterior', () => {
  const start = initialScores();
  const a = updateScores(start, { type: 'vote', side: 'a' });
  const b = updateScores(a, { type: 'vote', side: 'b', amount: 3 });
  assert.deepEqual(start, { a: 0, b: 0 });
  assert.deepEqual(b, { a: 1, b: 3 });
});
test('percentuais proporcionais inclusive quando apenas um lado recebeu votos', () => {
  assert.deepEqual(getPercentages({ a: 3, b: 1 }), { a: 75, b: 25 });
  assert.deepEqual(getPercentages({ a: 0, b: 2 }), { a: 0, b: 100 });
});
test('liderança alterna e empate positivo remove o líder', () => {
  assert.equal(getLeader({ a: 2, b: 1 }), 'a');
  assert.equal(getLeader({ a: 1, b: 2 }), 'b');
  assert.equal(getLeader({ a: 2, b: 2 }), null);
});
test('reset volta ao início depois de vários votos', () => {
  assert.deepEqual(
    updateScores({ a: 8, b: 4 }, { type: 'reset' }),
    initialScores(),
  );
});
test('rejeita quantidades inválidas, lado inválido e overflow', () => {
  for (const amount of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => updateScores(initialScores(), { type: 'vote', side: 'a', amount }),
      RangeError,
    );
  assert.throws(() =>
    updateScores(initialScores(), {
      type: 'vote',
      side: 'x',
    } as unknown as VoteEvent),
  );
  assert.throws(() =>
    updateScores(
      { a: Number.MAX_SAFE_INTEGER, b: 0 },
      { type: 'vote', side: 'b' },
    ),
  );
});
test('store notifica, protege seu estado e permite remover inscrição', () => {
  const store = createStore();
  let calls = 0;
  const off = store.subscribe(() => {
    calls++;
  });
  store.dispatch({ type: 'vote', side: 'a' });
  const copy = store.getState() as { a: number; b: number };
  copy.a = 999;
  assert.deepEqual(store.getState(), { a: 1, b: 0 });
  off();
  store.dispatch({ type: 'reset' });
  assert.equal(calls, 1);
  assert.deepEqual(store.getState(), initialScores());
});
