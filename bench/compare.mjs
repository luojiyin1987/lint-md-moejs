// Reproducible process-level comparison. Never use 'go run' in timing.
// Results are observational only: different hosts and JSON boundaries.
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cpus, platform, arch, release } from 'node:os';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { firstMismatch, describeMismatch } from './semantic.mjs';
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
const kinds = ['parseBare', 'parse', 'lint', 'fix'];
const repeats = smoke ? 1 : 3;
const warmup = smoke ? 1 : 10;
const iterations = smoke ? 2 : scaling ? 12 : 40;
const rows = [];
function execute(engine, mode, input, warm, emitResult = false) {
  const args = engine === 'moejs-go'
    ? ['-bundle', bundle, '-mode', mode, '-iterations', String(warm ? iterations : 0),
      '-warmup', String(warm ? warmup : 0)]
    : [nodeScript, '--bundle', bundle, '--mode', mode,
      '--iterations', String(warm ? iterations : 0),
      '--warmup', String(warm ? warmup : 0)];
  if (emitResult) {
    if (engine === 'moejs-go') args.push('-emit-result');
    else args.push('--emit-result', 'true');
  }
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
  if (warm) {
    assert.ok(value.warm?.opsPerSec > 0);
    if (engine === 'moejs-go') {
      assert.ok(value.goMemory?.bytesPerOp >= 0);
      assert.ok(value.goMemory?.allocsPerOp >= 0);
      assert.ok(value.goMemory?.gcCycles >= 0);
    }
  }
  return { ...value, processWallMs: wallMs };
}
function median(values) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}
for (const {name, input} of scenarios) {
  let parseBareResults;
  for (const mode of kinds) {
    // Fetch full structured results in separate, untimed processes.
    // This avoids injecting IPC payload size into the timed benchmark runs.
    const semantic = {
      'node-bundled': execute('node-bundled', mode, input, false, true),
      'moejs-go': execute('moejs-go', mode, input, false, true),
    };
    const difference = firstMismatch(semantic['node-bundled'].result, semantic['moejs-go'].result);
    if (difference) {
      const diagnostic = { scenario: name, mode, difference };
      writeFileSync(resolve(root, 'bench/mismatch.json'), JSON.stringify(diagnostic, null, 2) + '\n');
      throw new Error('Node.js/moejs semantic mismatch for ' + name + '/' + mode +
        ' at ' + describeMismatch(difference));
    }
    // parseBare and parse return the same small projection. This is an
    // additional invariant, independent of Node-vs-Go semantic parity.
    if (mode === 'parse') {
      for (const engine of ['moejs-go', 'node-bundled']) {
        const prior = parseBareResults[engine];
        const controlDifference = firstMismatch(prior, semantic[engine].result);
        if (controlDifference) {
          throw new Error('parse vs parseBare projection mismatch in ' + engine +
            ' (' + name + '): ' + describeMismatch(controlDifference));
        }
      }
    }
    if (mode === 'parseBare') parseBareResults = {
      'moejs-go': semantic['moejs-go'].result,
      'node-bundled': semantic['node-bundled'].result,
    };
    const observations = { 'moejs-go': [], 'node-bundled': [] };
    for (let i = 0; i < repeats; i++) {
      // Alternate order to mitigate, not eliminate, scheduler/cache bias.
      const order = i % 2 === 0 ? ['node-bundled', 'moejs-go'] : ['moejs-go', 'node-bundled'];
      for (const engine of order) {
        const cold = execute(engine, mode, input, false);
        const warm = execute(engine, mode, input, true);
        assert.equal(cold.digest, semantic[engine].digest,
          'baseline/cold mismatch within ' + engine + ' for ' + name + '/' + mode);
        assert.equal(warm.digest, semantic[engine].digest,
          'baseline/warm mismatch within ' + engine + ' for ' + name + '/' + mode);
        observations[engine].push({cold, warm});
      }
    }
    const expected = semantic['node-bundled'].digest;
    for (const engine of ['moejs-go', 'node-bundled']) {
      for (const {cold, warm} of observations[engine]) {
        // Different JSON encoders may serialize identical values differently.
        // Intra-host byte stability was verified above.
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
        goBytesPerOp: engine === 'moejs-go'
          ? median(items.map(o => o.warm.goMemory.bytesPerOp)) : null,
        goAllocsPerOp: engine === 'moejs-go'
          ? median(items.map(o => o.warm.goMemory.allocsPerOp)) : null,
        goGCCycles: engine === 'moejs-go'
          ? median(items.map(o => o.warm.goMemory.gcCycles)) : null,
        goGCPauseMs: engine === 'moejs-go'
          ? median(items.map(o => o.warm.goMemory.gcPauseMs)) : null,
        warmOpsPerSec: median(items.map(o => o.warm.warm.opsPerSec)),
        peakRssKiB: items.every(o => o.warm.peakRssKiB !== null)
          ? median(items.map(o => o.warm.peakRssKiB)) : null,
        outputDigest: expected, // Node reference's byte-level SHA-256, NOT cross-host equality.
        crossHostSemanticEqual: true,
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
  note: 'parseBare calls parseMd only; parse calls parseMdWithSourceMap. Both return identical root child count and UTF-16 source length projections, checked in both hosts. Go heap allocations/GC are deltas of runtime.MemStats over measured warm calls; they include Go runtime/interpreter overhead and background activity, not per-JS-object accounting. No forced GC, no timing thresholds. Node warm uses local JS call + stringify; Go warm also decodes and reserializes output. RSS is whole-process VmHWM.',
};
const report = {meta, rows};
if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log('PASS benchmark integrity:', rows.length,
  'rows, cross-host semantic equality and within-host SHA-256 stability');
