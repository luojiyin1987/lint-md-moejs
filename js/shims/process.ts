// VFile constructs a path context even for source-only Markdown.
// This experiment has no filesystem paths: provide a deterministic cwd.
// Any other process API must fail instead of silently emulating Node.js.
const processShim = new Proxy({ cwd: () => '/' }, {
  get(target, property) {
    if (property === 'cwd') return target.cwd;
    throw new Error('Unsupported Node process API: ' + String(property));
  },
});

export default processShim;
