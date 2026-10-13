import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintMarkdown } from '@lint-md/core';
import { lint as bundledLint } from './dist/lint-md.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function nativeLint(markdown) {
  const result = lintMarkdown(markdown, { rules: {}, ruleErrorPolicy: 'strict' });
  assert.equal(result.complete, true, 'native core result must be complete');
  assert.equal(result.executionErrors.length, 0, 'native core execution errors');

  return {
    complete: true,
    diagnostics: result.diagnostics.map((d) => {
      assert.ok(d.range, 'native core must supply source ranges');
      return {
        ruleId: d.ruleId,
        message: d.message,
        severity: d.severity,
        line: d.line,
        column: d.column,
        start: d.range.start.offset,
        end: d.range.end.offset,
        fixable: d.fixable ?? false,
      };
    }),
  };
}

const cases = [
  ['clean', 'Hello world\n'],
  ['mixed Chinese and English', '中文English 123\n'],
  ['punctuation', '你好,world.\n'],
  ['emoji UTF-16', '😀中文English\n'],
  ['fenced code', '`example`\n\n```js\nconst x = 1;\n```\n'],
  ['CRLF', '第一行\r\n第二行English\r\n'],
];

for (const [name, markdown] of cases) {
  const expected = nativeLint(markdown);
  assert.deepStrictEqual(
    bundledLint(markdown),
    expected,
    'Original Node.js core vs bundled Node.js core: ' + name,
  );

  let output;
  try {
    output = execFileSync(
      'go',
      ['run', './cmd/probe', '-bundle', 'js/dist/lint-md.mjs'],
      { cwd: root, input: markdown, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (error) {
    throw new Error('moejs failed on ' + name + ':\n' +
      (error.stderr || error.message), { cause: error });
  }
  assert.deepStrictEqual(
    JSON.parse(output),
    expected,
    'Original Node.js core vs moejs: ' + name,
  );
  console.log('PASS', name, '(' + expected.diagnostics.length + ' diagnostics)');
}
