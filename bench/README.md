# Runtime benchmark study (PR #4)

Compare **the same bundled `@lint-md/core@2.5.3` JS module** running inside
Node.js and inside Go/moejs (Go dependency is pinned in `go.mod`).
The inputs and exported `lint`/`fix` hooks are identical.

## Run

```sh
npm install --prefix js --no-audit --no-fund
npm run build --prefix js
go mod tidy
go build -o bench/lint-md-go ./cmd/bench
npm run bench:smoke --prefix js
npm run bench --prefix js -- --out bench/results.json
```

The driver checks a SHA-256 digest of the **complete serialized output** for
every cold and warm execution across both engines, refusing to compare
different answers. It alternates host order between trials.

## Metric interpretation

- **Cold process wall (ms):** launch a precompiled Go executable, or
  `node bench/node-runner.mjs`, and execute one hook. Go build, `npm install`,
  and esbuild compilation are excluded.
- **Prepare (ms):** Go reads and compiles the ESM, then loads it in a new
  runtime; Node dynamically imports the bundled ESM. These stages are
  *not identical operations*.
- **First call (ms):** one invocation including serialization.
- **Warm calls (ms, calls/s):** repeated same-input hook calls inside a
  single process after warmup. Go uses one loaded runtime and decodes the
  return value into its typed Go struct before encoding JSON. Node calls
  JS directly and uses `JSON.stringify`. Thus this measures *embeddable
  host-interface overhead*, not the raw engine interpreter in isolation.
  Input and output are deterministic; Go calls `ReleaseCallData` each time.
- **Peak RSS KiB:** Linux `VmHWM` for the entire process. It includes
  runtimes, Go/Node infrastructure, JS bundle and allocations. It is not a
  per-runtime memory measurement, and cannot quantify idle worker pools.
- **Cold runs:** repeated launches, no benchmark process reuse. Go executable
  is built before measurement; Node's engine and module load happen on start.
- **Trials:** 3 per host/workload, report median; p95 is an intra-trial p95
  over individual calls. These tiny samples are exploratory, not a stable
  microbenchmark or statistically powered comparison.
- **Scenarios:** small and ~28 KiB Markdown with Chinese, numbers, links,
  blockquotes and fenced code, both lint and multi-pass default fixes.

Do not claim superiority from one CI runner. Use a dedicated machine,
record CPU / OS / versions and repeat more times. Avoid comparing JSON
serialization costs as if they were just JavaScript engine execution costs.

The PR CI runs only a **smoke** harness to verify the result hashes and
metrics shape; no timing threshold can make CI flaky. The dedicated benchmark
workflow is manual to avoid spending CI minutes or interpreting noisy CI
measurements as production results.

## PR #5: Attribute cost before optimizing

The bundled entrypoint exports `parse(markdown)` to run
`parseMdWithSourceMap()` and project just a root child count and UTF-16 source
length. This uses the same parser and source-map builder as lint-md's rule
engine, with **no rule traversal or diagnostic projection**. Comparing
`parse` to `lint` is a directional diagnostic, **not a precise subtraction
to determine rule cost**; they execute different operations.

Warm Go benchmark reports additional per-call medians:
`callMedianMs` (JS runtime call), `decodeMedianMs` (`rt.Unmarshal`)
and `serializeMedianMs` (`json.Marshal`). The Node runner reports
`callMedianMs` and `serializeMedianMs` (`JSON.stringify`).
The total median is not the sum of stage medians. Both executions keep their
current output integrity checks; a mismatch fails the comparison.

```sh
npm run bench:smoke --prefix js
npm run bench:scale --prefix js -- --out bench/scaling-results.json
node --input-type=module -e "import { fixture } from './bench/workload.mjs'; process.stdout.write(fixture(160))" > bench/profile-input.md
./bench/lint-md-go -bundle js/dist/lint-md.mjs -mode lint \
  -warmup 5 -iterations 50 \
  -cpu-profile bench/cpu.pprof -heap-profile bench/heap.pprof \
  < bench/profile-input.md > bench/profile-report.json
go tool pprof -top bench/cpu.pprof
go tool pprof -alloc_space -top bench/heap.pprof
```

The scale test uses 1, 8, 32 and 160 copies of the same Markdown paragraph,
with stable output hashes and no timing assertions. A CPU profile starts
**after warmup**, measures warm calls only and ends before heap collection.
The heap profile follows a forced Go GC and describes retained Go allocations;
`-alloc_space` displays allocation history rather than live RSS. Profiles
are diagnostic, not comparable timing benchmarks (profiling adds overhead).
Go pprof does not precisely label individual JavaScript parser and rule
functions; it identifies Go runtime call stacks and memory hot spots.
Please do not interpret one GitHub runner as production performance evidence.
