// Node counterpart for the same bundled JS entrypoint. Deliberately measures
// in-process hook+JSON serialization, whereas Go includes its interop decode.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const opts = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1])
    throw new Error('expected --option value');
  opts[process.argv[i].slice(2)] = process.argv[i + 1];
}
const mode = opts.mode ?? 'lint';
const iterations = Number(opts.iterations ?? 100);
const warmup = Number(opts.warmup ?? 10);
if (!['lint', 'fix'].includes(mode) || !Number.isSafeInteger(iterations) ||
    !Number.isSafeInteger(warmup) || iterations < 0 || warmup < 0) {
  throw new Error('invalid benchmark arguments');
}
const input = readFileSync(0, 'utf8');
if (Buffer.byteLength(input) > 8 * 1024 * 1024)
  throw new Error('input exceeds 8 MiB benchmark limit');

const beforeImport = performance.now();
const bundle = await import(pathToFileURL(resolve(opts.bundle ?? 'js/dist/lint-md.mjs')).href);
const hook = bundle[mode];
if (typeof hook !== 'function') throw new Error('missing hook: ' + mode);
const prepareMs = performance.now() - beforeImport;
const call = () => {
  const out = mode === 'fix' ? hook(input, 'default') : hook(input);
  if (out.complete !== true) throw new Error('incomplete output');
  const value = JSON.stringify(out);
  if (!value) throw new Error('empty serialization');
  return value;
};
const firstStart = performance.now();
const first = call();
const firstMs = performance.now() - firstStart;
const digest = createHash('sha256').update(first).digest('hex');
function verify(s) {
  if (createHash('sha256').update(s).digest('hex') !== digest)
    throw new Error('non-deterministic output');
}
for (let i = 0; i < warmup; i++) verify(call());
const samples = [];
let totalMs = 0;
for (let i = 0; i < iterations; i++) {
  const started = performance.now();
  const output = call();
  const ms = performance.now() - started;
  verify(output);
  samples.push(ms);
  totalMs += ms;
}
samples.sort((a, b) => a - b);
const warm = iterations === 0 ? null : {
  medianMs: samples[Math.floor(iterations / 2)],
  p95Ms: samples[Math.ceil(iterations * 0.95) - 1],
  totalMs,
  opsPerSec: iterations * 1000 / totalMs,
};
let peakRssKiB = null;
try {
  const match = readFileSync('/proc/self/status', 'utf8').match(/^VmHWM:\s+(\d+) kB/m);
  if (match) peakRssKiB = Number(match[1]);
} catch { /* Non-Linux platforms cannot report /proc VmHWM. */ }
process.stdout.write(JSON.stringify({
  engine: 'node-bundled',
  mode,
  bytes: Buffer.byteLength(input),
  iterations,
  warmup,
  prepareMs,
  firstMs,
  warm,
  peakRssKiB,
  digest,
}) + '\n');
