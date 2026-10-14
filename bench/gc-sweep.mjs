// Process-isolated Go GOGC sensitivity experiment. No speed thresholds.
// Keep the workload bounded: GOGC=off is intentionally NOT sampled.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cpus, platform, release, arch } from 'node:os';
import { fixture } from './workload.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const smoke = process.argv.includes('--smoke');
const outputIndex = process.argv.indexOf('--out');
if (outputIndex !== -1 && (!process.argv[outputIndex + 1] ||
    process.argv[outputIndex + 1].startsWith('--'))) {
  throw new Error('--out requires a filename');
}
const outputPath = outputIndex < 0 ? null : resolve(root, process.argv[outputIndex + 1]);
const binary = resolve(root, process.env.GO_BENCH_BIN ?? 'bench/lint-md-go');
const bundle = resolve(root, 'js/dist/lint-md.mjs');
const input = fixture(smoke ? 8 : 32);
const cycles = smoke ? 1 : 3;
const iterations = smoke ? 2 : 12;
const warmup = smoke ? 1 : 3;
const settings = ['50', '100', '200'];
const modes = ['parseBare', 'parse'];
const observations = new Map();

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
for (let trial = 0; trial < cycles; trial++) {
  const rotated = settings.slice(trial % settings.length)
    .concat(settings.slice(0, trial % settings.length));
  for (const mode of modes) {
    for (const gogc of rotated) {
      const child = spawnSync(binary, [
        '-bundle', bundle, '-mode', mode,
        '-iterations', String(iterations), '-warmup', String(warmup),
      ], {
        cwd: root, input, encoding: 'utf8',
        timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
        env: {...process.env, GOGC: gogc},
      });
      if (child.error || child.signal || child.status !== 0)
        throw new Error('GOGC=' + gogc + ' ' + mode + ': ' +
          (child.error?.message ?? child.stderr ?? child.signal));
      const result = JSON.parse(child.stdout);
      assert.equal(result.mode, mode);
      assert.equal(result.engine, 'moejs-go');
      assert.equal(result.bytes, Buffer.byteLength(input));
      assert.ok(result.warm?.opsPerSec > 0);
      assert.ok(result.goMemory?.allocsPerOp >= 0);
      assert.ok(result.goMemory?.bytesPerOp >= 0);
      assert.ok(result.goMemory?.gcCycles >= 0);
      assert.ok(result.goMemory?.gcPauseMs >= 0);
      assert.equal(typeof result.digest, 'string');
      const baselineKey = 'hash:' + trial;
      const previous = observations.get(baselineKey);
      if (previous !== undefined) assert.equal(result.digest, previous,
        'parser outputs changed between GOGC or source-map settings');
      observations.set(baselineKey, result.digest);
      const key = mode + '/' + gogc;
      observations.set(key, [...(observations.get(key) ?? []), result]);
    }
  }
}
const rows = [];
for (const mode of modes) {
  for (const gogc of settings) {
    const samples = observations.get(mode + '/' + gogc);
    const row = {
      mode, gogc: Number(gogc), inputBytes: Buffer.byteLength(input),
      trials: samples.length, warmup, iterations,
      warmMedianMs: median(samples.map(x => x.warm.medianMs)),
      warmP95Ms: median(samples.map(x => x.warm.p95Ms)),
      peakRssKiB: median(samples.map(x => x.peakRssKiB)),
      bytesPerOp: median(samples.map(x => x.goMemory.bytesPerOp)),
      allocsPerOp: median(samples.map(x => x.goMemory.allocsPerOp)),
      gcCycles: median(samples.map(x => x.goMemory.gcCycles)),
      gcPauseMs: median(samples.map(x => x.goMemory.gcPauseMs)),
    };
    rows.push(row);
    console.log(mode, 'GOGC=' + gogc,
      'warm=' + row.warmMedianMs.toFixed(2) + 'ms',
      'B/op=' + row.bytesPerOp.toFixed(0),
      'allocs/op=' + row.allocsPerOp.toFixed(0),
      'GCs=' + row.gcCycles,
      'peakRSS=' + row.peakRssKiB + 'KiB');
  }
}
if (outputPath) {
  const report = {
    environment: {
      cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length,
      arch: arch(), os: platform(), kernel: release(),
      goVersion: execFileSync('go', ['version'], {cwd: root, encoding: 'utf8'}).trim(),
      sha: process.env.GITHUB_SHA ?? null, smoke,
      disclaimer: 'Process-isolated Go GOGC experiment; small exploratory sample, shared-runner noise. ReadMemStats includes entire Go process, not per-JS allocation. No forced GC. Peak RSS measures entire process. No performance thresholds.',
    }, rows,
  };
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
}
console.log('PASS GC sweep:', rows.length, 'rows, stable output hashes');
