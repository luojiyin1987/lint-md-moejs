# lint-md-moejs

Research prototype: run the existing JavaScript `@lint-md/core` in a Go host using [moejs](https://github.com/Calcium-Ion/moejs). This is not a replacement for `@lint-md/cli`.

## Scope of PR #1

- Bundle the published `@lint-md/core@2.5.3` (which uses the existing `@lint-md/parser`) as a single ESM module.
- Execute the exported `lint(markdown)` hook with moejs `v0.1.0-alpha.6`.
- Compare diagnostics against the same bundle executed in Node.js, including Chinese text, emoji and CRLF.
- Surface compilation, runtime and decoding failures rather than hiding differences.

## Try it

Prerequisites: Go 1.25+, Node.js 22+, npm. From the repository root:

```sh
npm install --prefix js --no-audit --no-fund
npm run build --prefix js
go mod tidy
go test ./...
npm run compare --prefix js
printf '中文English 123\n' | go run ./cmd/probe -bundle js/dist/lint-md.mjs
```

`npm run compare` calls Go once for each fixture and checks that the parsed JSON result matches Node.js. Nonzero exit codes are failures, not skipped tests. The bundle is a generated local artifact, never committed.

## First CI observation (2026-10-13)

The published @lint-md/parser 0.4.0 ESM distribution contains imports for Node built-ins path, process and url. A neutral ESM bundle of the published @lint-md/core@2.5.3 therefore fails during esbuild resolution before moejs can execute it. This is a concrete compatibility blocker, not an engine benchmark. The build intentionally fails rather than adding unproven shims or silently externalizing the Node modules.

## What remains unproven

The published parser pulls in remark/micromark and related dependencies. ESM bundling does not guarantee that the code is compatible with moejs or that it avoids Node.js-specific APIs. The CI workflow is the execution oracle for this first spike. If it fails, use the build/compile/load/call stage from stderr to record the blocker; do not add broad shims just to turn the check green.

This stage does not measure throughput, implement concurrent workers or expose a CLI interface for production use. The TypeScript implementation remains the behavioral reference. A future PR may add a larger pinned fixture corpus and performance benchmarks if the compatibility experiment succeeds.

## PR #2: string-only bundling compatibility

The published parser's ESM bundle imports Node's `path`, `process`, and
`url` even when linting a string. A neutral esbuild build substitutes three
**restricted** experiment-only modules:

- `process.cwd()` returns `/`, because no paths are passed to the parser.
- Every `path` API throws if accessed.
- `fileURLToPath` throws if accessed.

These are **not** general Node.js polyfills. If a new dependency needs a
path operation, the test fails and that behavior must be investigated rather
than silently emulated. The differential suite compares three paths:
the original published Core running in Node.js, the bundled Core in Node.js,
and the bundled Core in moejs. Matching only the two bundled executions
would not establish compatibility with the original engine.

The original Core API and its public source-location contract remain the
source of truth; no production implementation changes are proposed.
