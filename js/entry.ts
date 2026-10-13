import { lintMarkdown, fixMarkdown } from '@lint-md/core';
import { rulesForScenario } from './fix-scenarios.mjs';

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
