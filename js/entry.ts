import { lintMarkdown, fixMarkdown } from '@lint-md/core';
import { parseMdWithSourceMap } from '@lint-md/parser';
import { rulesForScenario } from './fix-scenarios.mjs';

// Parse-only measures the same parser + source-map path used by lint-md,
// without traversing rules. The AST remains entirely inside JavaScript.
export function parse(markdown: string) {
  const { ast, sourceMap } = parseMdWithSourceMap(markdown);
  if (!sourceMap || !Array.isArray(ast.children)) {
    throw new Error('unexpected parse result');
  }
  return {
    complete: true,
    nodeCount: ast.children.length,
    sourceLength: markdown.length,
  };
}

// Preserve the public diagnostic range contract: offsets are UTF-16 units.
function projectDiagnostics(diagnostics: ReturnType<typeof lintMarkdown>['diagnostics']) {
  return diagnostics.map((d) => {
    if (!d.range) throw new Error('missing source range for ' + d.ruleId);
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

export function lint(markdown: string) {
  const result = lintMarkdown(markdown, {
    rules: {},
    ruleErrorPolicy: 'strict',
  });
  if (!result.complete || result.executionErrors.length !== 0) {
    throw new Error('lint-md core returned incomplete results');
  }
  return {
    complete: result.complete,
    diagnostics: projectDiagnostics(result.diagnostics),
  };
}

// Test-only fix export. The caller receives the initial and remaining
// diagnostics in their *respective* coordinate spaces.
export function fix(markdown: string, scenario = 'default') {
  const result = fixMarkdown(markdown, {
    rules: rulesForScenario(scenario),
    ruleErrorPolicy: 'strict',
  });
  if (!result.complete || result.executionErrors.length !== 0) {
    throw new Error('lint-md core returned incomplete fix results');
  }
  const fixed = result.fixedResult;
  if (!fixed || typeof fixed.rounds !== 'number' || !fixed.convergence) {
    throw new Error('lint-md core returned an invalid fix result');
  }
  return {
    complete: result.complete,
    fixedText: fixed.result,
    convergence: fixed.convergence,
    rounds: fixed.rounds,
    initialDiagnostics: projectDiagnostics(result.initialDiagnostics),
    remainingDiagnostics: projectDiagnostics(result.remainingDiagnostics),
    notAppliedFixes: fixed.notAppliedFixes.map((f) => ({
      start: f.range[0],
      end: f.range[1],
      text: f.text,
      targetRule: f.targetRule,
      reason: f.reason,
    })),
  };
}
