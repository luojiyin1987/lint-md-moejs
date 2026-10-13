import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint } from './dist/lint-md.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  ['clean', 'Hello world\n'],
  ['mixed Chinese and English', '中文English 123\n'],
  ['punctuation', '你好,world.\n'],
  ['emoji UTF-16', '😀中文English\n'],
  ['fenced code', '`example`\n\n```js\nconst x = 1;\n```\n'],
  ['CRLF', '第一行\r\n第二行English\r\n'],
];

for (const [name, markdown] of cases) {
  const expected = lint(markdown);
  let output;
  try {
    output = execFileSync(
      'go',
      ['run', './cmd/probe', '-bundle', 'js/dist/lint-md.mjs'],
      { cwd: root, input: markdown, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (error) {
    throw new Error(
      'moejs failed on ' + name + ':\n' +
      (error.stderr || error.message),
      { cause: error },
    );
  }
  const actual = JSON.parse(output);
  assert.deepStrictEqual(actual, expected, 'Node.js/moejs mismatch: ' + name);
  console.log('PASS', name, '(' + expected.diagnostics.length + ' diagnostics)');
}
