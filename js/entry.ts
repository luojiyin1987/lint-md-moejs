import { lintMarkdown } from '@lint-md/core';

// Keep this projection narrow: it captures the public lint diagnostics and
// avoids depending on internal parser objects when crossing the Go/JS boundary.
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
    diagnostics: result.diagnostics.map((d) => {
      if (!d.range) {
        throw new Error('missing source range for ' + d.ruleId);
      }
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
