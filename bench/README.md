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
- **Scenarios:** small and ~20 KiB Markdown with Chinese, numbers, links,
  blockquotes and fenced code, both lint and multi-pass default fixes.

Do not claim superiority from one CI runner. Use a dedicated machine,
record CPU / OS / versions and repeat more times. Avoid comparing JSON
serialization costs as if they were just JavaScript engine execution costs.

The PR CI runs only a **smoke** harness to verify the result hashes and
metrics shape; no timing threshold can make CI flaky. The dedicated benchmark
workflow is manual to avoid spending CI minutes or interpreting noisy CI
measurements as production results.
