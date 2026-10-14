import test from 'node:test';
import assert from 'node:assert/strict';
import { firstMismatch, describeMismatch } from './semantic.mjs';

test('parsed JSON equality ignores escape spelling and key order', () => {
  const go = JSON.parse('{"fixedText":"\\u003e 引用","rounds":2,"diagnostics":[]}');
  const node = JSON.parse('{"diagnostics":[],"rounds":2,"fixedText":"> 引用"}');
  assert.equal(firstMismatch(node, go), null);
});

test('nested mismatch includes the exact field path', () => {
  const a = { remainingDiagnostics: [{ ruleId: 'x', line: 3 }] };
  const b = { remainingDiagnostics: [{ ruleId: 'x', line: 4 }] };
  const difference = firstMismatch(a, b);
  assert.equal(difference.path, '$.remainingDiagnostics[0].line');
  assert.match(describeMismatch(difference), /expected 3, actual 4/);
});

test('missing keys and array length changes are rejected', () => {
  assert.deepEqual(firstMismatch({complete:true}, {}).path, '$.complete');
  assert.deepEqual(firstMismatch({items:[1,2]}, {items:[1]}).path, '$.items.length');
});

test('non-BMP Unicode and HTML markers survive decoding', () => {
  const original = { fixedText: '😀 < > & 中英文 e\u0301' };
  const escaped = JSON.parse('{"fixedText":"😀 \\u003c \\u003e \\u0026 中英文 e\\u0301"}');
  assert.equal(firstMismatch(original, escaped), null);
});
