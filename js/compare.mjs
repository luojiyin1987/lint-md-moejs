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
  ['empty document', ''],
  ['blank lines', '\n\n'],
  ['frontmatter', '---\ntitle: 你好\n---\n\n中文English\n'],
  ['GFM table', '| 中文 | English |\n| --- | --- |\n| 你好 | world |\n'],
  ['link', '[中文](https://example.com)English\n'],
  ['nested blockquote', '> 中文English\n> - 版本123\n'],
  ['combining characters', 'e\u0301 😀 中文English\n'],
  ['inline code', '内联 `中文English` 后面English\n'],
  ['math', '$x+y$ 中文English\n'],
  ['repeated paragraphs', '中文English 123\n\n'.repeat(20)],
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
