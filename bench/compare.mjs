// Reproducible process-level comparison. Never use 'go run' in timing.
// Results are observational only: different hosts and JSON boundaries.
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cpus, platform, arch, release } from 'node:os';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { fixture } from './workload.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const smoke = process.argv.includes('--smoke');
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && (!process.argv[outIndex + 1] || process.argv[outIndex + 1].startsWith('--')))
  throw new Error('--out requires a filename');
const outputPath = outIndex === -1 ? null : resolve(root, process.argv[outIndex + 1]);

const goBinary = resolve(root, process.env.GO_BENCH_BIN ?? 'bench/lint-md-go');
const nodeScript = resolve(root, 'bench/node-runner.mjs');
const bundle = resolve(root, 'js/dist/lint-md.mjs');
const scaling = process.argv.includes('--scale');
const scenarios = scaling
  ? [1, 8, 32, 160].map((repeat) => ({
      name: 'repeat-' + repeat, input: fixture(repeat),
    }))
  : [
      {name: 'small', input: fixture(1)},
      {name: 'large', input: fixture(160)},
    ];
const kinds = smoke ? ['parse', 'lint'] : ['parse', 'lint', 'fix'];
const repeats = smoke ? 1 : 3;
const warmup = smoke ? 1 : 10;
const iterations = smoke ? 2 : scaling ? 12 : 40;
const rows = [];
function execute(engine, mode, input, warm) {
  const args = engine === 'moejs-go'
    ? ['-bundle', bundle, '-mode', mode, '-iterations', String(warm ? iterations : 0),
      '-warmup', String(warm ? warmup : 0)]
    : [nodeScript, '--bundle', bundle, '--mode', mode,
      '--iterations', String(warm ? iterations : 0),
      '--warmup', String(warm ? warmup : 0)];
  const executable = engine === 'moejs-go' ? goBinary : process.execPath;
  const start = performance.now();
  const child = spawnSync(executable, args, {
    cwd: root, input, encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024, timeout: 120_000,
  });
  const wallMs = performance.now() - start;
  if (child.error || child.status !== 0 || child.signal) {
    throw new Error(engine + ' ' + mode + ' failed: ' +
      (child.error?.message ?? child.stderr ?? child.signal));
  }
  const value = JSON.parse(child.stdout);
  assert.equal(value.engine, engine);
  assert.equal(value.mode, mode);
  assert.equal(value.bytes, Buffer.byteLength(input));
  if (warm) assert.ok(value.warm?.opsPerSec > 0);
  return { ...value, processWallMs: wallMs };
}
function median(values) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}
for (const {name, input} of scenarios) {
  for (const mode of kinds) {
    const observations = { 'moejs-go': [], 'node-bundled': [] };
    for (let i = 0; i < repeats; i++) {
      // Alternate order to mitigate, not eliminate, scheduler/cache bias.
      const order = i % 2 === 0 ? ['node-bundled', 'moejs-go'] : ['moejs-go', 'node-bundled'];
      for (const engine of order) {
        const cold = execute(engine, mode, input, false);
        const warm = execute(engine, mode, input, true);
        assert.equal(cold.digest, warm.digest, 'cold/warm mismatch');
        observations[engine].push({cold, warm});
      }
    }
    const expected = observations['node-bundled'][0].cold.digest;
    for (const engine of ['moejs-go', 'node-bundled']) {
      for (const {cold, warm} of observations[engine]) {
        assert.equal(cold.digest, expected, 'Node.js/moejs output mismatch: '+name+'/'+mode);
        assert.equal(warm.digest, expected, 'warm result mismatch');
      }
      const items = observations[engine];
      const row = {
        scenario: name,
        mode,
        engine,
        bytes: Buffer.byteLength(input),
        trials: repeats,
        coldStartWallMs: median(items.map(o => o.cold.processWallMs)),
        prepareMs: median(items.map(o => o.cold.prepareMs)),
        firstCallMs: median(items.map(o => o.cold.firstMs)),
        warmMedianMs: median(items.map(o => o.warm.warm.medianMs)),
        warmCallMedianMs: median(items.map(o => o.warm.warm.callMedianMs)),
        warmDecodeMedianMs: engine === 'moejs-go'
          ? median(items.map(o => o.warm.warm.decodeMedianMs)) : null,
        warmSerializeMedianMs: median(items.map(o => o.warm.warm.serializeMedianMs)),
        warmP95Ms: median(items.map(o => o.warm.warm.p95Ms)),
        warmOpsPerSec: median(items.map(o => o.warm.warm.opsPerSec)),
        peakRssKiB: items.every(o => o.warm.peakRssKiB !== null)
          ? median(items.map(o => o.warm.peakRssKiB)) : null,
        outputDigest: expected,
      };
      rows.push(row);
      console.log(name, mode, engine,
        'cold=' + row.coldStartWallMs.toFixed(2) + 'ms',
        'warm=' + row.warmMedianMs.toFixed(3) + 'ms/call',
        'ops/s=' + row.warmOpsPerSec.toFixed(0),
        'peakRSS=' + (row.peakRssKiB ?? 'n/a') + 'KiB');
    }
  }
}
const meta = {
  generatedAt: new Date().toISOString(),
  cpu: cpus()[0]?.model ?? 'unknown',
  logicalCpus: cpus().length,
  platform: platform(),
  arch: arch(),
  kernel: release(),
  node: process.version,
  go: execFileSync('go', ['version'], {cwd:root, encoding:'utf8'}).trim(),
  sha: process.env.GITHUB_SHA ?? null,
  smoke,
  scaling,
  warmup,
  iterations,
  repeats,
  note: 'Go warm = JS call + Go Unmarshal + JSON Marshal. Node warm = local JS call + JSON.stringify. Node call/serialize stages are additional observations. The parse hook includes parser + source-map construction, with no rule execution; parse and lint timings are NOT strictly additive. Cold process wall includes runtime/process startup but excludes Go build and JS bundle build. RSS is process VmHWM; results are not pure JS-engine benchmarks. No performance thresholds.',
};
const report = {meta, rows};
if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log('PASS benchmark integrity:', rows.length, 'rows, identical SHA-256 outputs');
