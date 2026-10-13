// The source-only lint probe should never perform filesystem path I/O.
// Fail explicitly if @lint-md/parser starts depending on path operations.
const pathShim = new Proxy({}, {
  get(_target, property) {
    throw new Error('Unsupported Node path API: ' + String(property));
  },
});

export default pathShim;
