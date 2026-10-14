import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseBare } from '../js/dist/lint-md.mjs';
import { fixture } from './workload.mjs';

for (const [name, input] of [
  ['empty', ''],
  ['Unicode and CRLF', '中文😀\r\nalpha e\u0301\n'],
  ['frontmatter and GFM', '---\ntitle: hello\n---\n\n|a|b|\n|-|-|\n|1|2|\n'],
  ['one paragraph', fixture(1)],
  ['eight paragraphs', fixture(8)],
]) {
  test('bare and source-map parser projections agree: ' + name, () => {
    const bare = parseBare(input);
    const mapped = parse(input);
    assert.deepStrictEqual(bare, mapped);
    assert.equal(bare.complete, true);
    assert.equal(bare.sourceLength, input.length);
    assert.ok(Number.isSafeInteger(bare.nodeCount) && bare.nodeCount >= 0);
  });
}
