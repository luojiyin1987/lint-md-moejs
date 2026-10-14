// Compare decoded JSON values, never cross-language serialization bytes.
// JSON.stringify and Go's encoding/json legitimately escape characters
// differently (for example ">" vs "\\u003e").
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const pathKey = (path, key) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
  ? path + '.' + key : path + '[' + JSON.stringify(key) + ']';

export function firstMismatch(expected, actual, path = '$') {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null ||
      typeof expected !== 'object' || typeof actual !== 'object' ||
      Array.isArray(expected) !== Array.isArray(actual)) {
    return { path, expected, actual };
  }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) {
      return { path: path + '.length', expected: expected.length, actual: actual.length };
    }
    for (let i = 0; i < expected.length; i++) {
      const diff = firstMismatch(expected[i], actual[i], path + '[' + i + ']');
      if (diff) return diff;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    const next = pathKey(path, key);
    if (!has(expected, key) || !has(actual, key)) {
      return {
        path: next,
        expected: has(expected, key) ? expected[key] : '[missing]',
        actual: has(actual, key) ? actual[key] : '[missing]',
      };
    }
    const diff = firstMismatch(expected[key], actual[key], next);
    if (diff) return diff;
  }
  return null;
}

export function describeMismatch(diff, max = 180) {
  const snippet = value => {
    const str = JSON.stringify(value);
    const printable = str ?? String(value);
    return printable.length > max ? printable.slice(0, max) + '…' : printable;
  };
  return diff.path + ': expected ' + snippet(diff.expected) +
    ', actual ' + snippet(diff.actual);
}
