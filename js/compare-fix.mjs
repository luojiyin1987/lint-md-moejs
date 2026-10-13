import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixMarkdown } from '@lint-md/core';
import { rulesForScenario } from './fix-scenarios.mjs';
import { fix as bundledFix } from './dist/lint-md.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function nativeDiagnostics(items) {
  return items.map((d) => {
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
  });
}

// The oracle calls the original published Core, not the bundled Core.
// Timings are deliberately excluded: they cannot match across engines.
function nativeFix(markdown, scenario) {
  const result = fixMarkdown(markdown, {
    rules: rulesForScenario(scenario),
    ruleErrorPolicy: 'strict',
  });
  assert.equal(result.complete, true);
  assert.equal(result.executionErrors.length, 0);
  const fixed = result.fixedResult;
  assert.ok(fixed);
  return {
    complete: true,
    fixedText: fixed.result,
    convergence: fixed.convergence,
    rounds: fixed.rounds,
    initialDiagnostics: nativeDiagnostics(result.initialDiagnostics),
    remainingDiagnostics: nativeDiagnostics(result.remainingDiagnostics),
    notAppliedFixes: fixed.notAppliedFixes.map((f) => ({
      start: f.range[0],
      end: f.range[1],
      text: f.text,
      targetRule: f.targetRule,
      reason: f.reason,
    })),
  };
}

const cases = [
  ['clean', 'Hello world\n', 'default'],
  ['Chinese alphabet and digits', '中文English 123\n', 'default'],
  ['full-width digits', '版本１２３\n', 'default'],
  ['emoji and combining', '😀中文English e\u0301\n', 'default'],
  ['CRLF', '第一行English\r\n第二行１２\r\n', 'default'],
  ['inline code', '这里 ` 中文 ` 后面English\n', 'default'],
  ['fenced code', '```\nconst x = 1;\n```\n\n中文English\n', 'default'],
  ['frontmatter', '---\ntitle: 中文English\n---\n\n中文English\n', 'default'],
  ['empty', '', 'default'],
  ['GFM table', '| 中文 | English |\n| --- | --- |\n| 你好 | world |\n', 'default'],
  ['multi-round', 'alpha', 'multi'],
  ['cycle detection', 'alpha', 'cycle'],
  ['overlapping fixes', 'abcdef', 'overlap'],
  ['same-offset insertions', 'abcdef', 'same-offset'],
  ['max rounds', 'z', 'max'],
];

for (const [name, markdown, scenario] of cases) {
  const expected = nativeFix(markdown, scenario);

  if (scenario === 'multi') {
    assert.equal(expected.convergence, 'stable');
    assert.ok(expected.rounds >= 3, 'expected cascading fixes');
    assert.equal(expected.fixedText, 'gamma');
  }
  if (scenario === 'cycle') {
    assert.equal(expected.convergence, 'cycle');
    assert.equal(expected.fixedText, 'alpha');
  }
  if (scenario === 'overlap' || scenario === 'same-offset') {
    assert.ok(expected.notAppliedFixes.length > 0, 'expected a retained conflict');
    assert.ok(expected.notAppliedFixes.every((f) => f.reason ===
      (scenario === 'overlap' ? 'overlap' : 'same-offset')));
  }
  if (scenario === 'max') {
    assert.equal(expected.convergence, 'max');
    assert.equal(expected.rounds, 10);
  }

  assert.deepStrictEqual(
    bundledFix(markdown, scenario), expected,
    'original Core vs bundled Core: ' + name,
  );

  let output;
  try {
    output = execFileSync(
      'go', ['run', './cmd/probe', '-bundle', 'js/dist/lint-md.mjs',
        '-fix', '-scenario', scenario],
      { cwd: root, input: markdown, encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (error) {
    throw new Error('moejs failed on ' + name + ':\n' +
      (error.stderr || error.message), { cause: error });
  }

  assert.deepStrictEqual(
    JSON.parse(output), expected, 'original Core vs moejs: ' + name,
  );
  console.log('PASS fix', name, expected.convergence,
    '(' + expected.rounds + ' rounds, ' +
    expected.notAppliedFixes.length + ' conflicts)');
}
