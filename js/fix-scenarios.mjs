// Fixture-only custom rules; this module is imported unchanged by the
// published Node.js oracle and the bundled moejs experiment.
// No process I/O or Node globals are used by these rules.
function rule(name, replacement) {
  return {
    meta: { name },
    create(context) {
      return {
        text(node) {
          // The custom fixtures are single plain-text nodes.
          if (node.position?.start?.offset !== 0 ||
              node.position?.end?.offset !== context.markdown.length) {
            return;
          }
          const fix = replacement(context.markdown);
          if (!fix) return;
          context.report({
            range: fix.range,
            message: name,
            fix: (fixer) => fixer.replaceTextRange(fix.range, fix.text),
          });
        },
      };
    },
  };
}

const nextTwoSteps = rule('fixture-multi-round', (text) => {
  const next = text === 'alpha' ? 'beta' : text === 'beta' ? 'gamma' : null;
  return next === null ? null : { range: [0, text.length], text: next };
});
const toggle = rule('fixture-cycle', (text) => {
  const next = text === 'alpha' ? 'beta' : text === 'beta' ? 'alpha' : null;
  return next === null ? null : { range: [0, text.length], text: next };
});
const conflictLeft = rule('fixture-conflict-left', (text) =>
  text === 'abcdef' ? { range: [0, 2], text: 'ab' } : null);
const conflictRight = rule('fixture-conflict-right', (text) =>
  text === 'abcdef' ? { range: [1, 3], text: 'XY' } : null);
const sameOffsetLeft = rule('fixture-insert-left', (text) =>
  text === 'abcdef' ? { range: [1, 1], text: '' } : null);
const sameOffsetRight = rule('fixture-insert-right', (text) =>
  text === 'abcdef' ? { range: [1, 1], text: '' } : null);
const grow = rule('fixture-max-rounds', (text) =>
  /^z+$/.test(text) ? { range: [text.length, text.length], text: 'z' } : null);

export function rulesForScenario(scenario) {
  const selected = {
    default: [],
    multi: [nextTwoSteps],
    cycle: [toggle],
    overlap: [conflictLeft, conflictRight],
    'same-offset': [sameOffsetLeft, sameOffsetRight],
    max: [grow],
  }[scenario];
  if (!selected) throw new Error('unknown fix scenario: ' + scenario);
  const rules = {};
  for (const item of selected) rules[item.meta.name] = [item, 2, {}];
  return rules;
}
