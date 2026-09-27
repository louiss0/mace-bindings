# @code-fixer-23/mace-node

Node.js 22+ bindings for the Mace processor C ABI. This package loads a
platform-specific Go shared library through Koffi; it never launches `mace`.
Calls are asynchronous and Koffi executes processor calls on native worker
threads. At most four evaluations run at once; further calls queue in
submission order. A library ABI-major mismatch fails before evaluation.

```ts
import { json, transform } from '@code-fixer-23/mace-node'

const value = await json('./config.mace', { cwd: process.cwd() })
const inline = await transform("[output = 'data']\n{ name: 'Ada', }")
const injected = await json('./runtime.mace', { input: '{ env: "prod", }' })
```

`json(path, { input?, cwd?, timeoutMs?, signal? })` evaluates a file inside `cwd` (the workspace
root). `transform(source, { input?, cwd?, sourceName?, timeoutMs?, signal? })` evaluates in-memory
source with imports relative to `cwd`. `input` is a Mace record literal, not a
JavaScript object. `cwd` defaults to the process working directory. Remote
HTTP(S) imports remain available. `jsonText` and `output` still evaluate files
but are deprecated aliases for `json`; the CLI-only `import*` functions and
`macePath` option have been removed.

Results contain ordinary nested JavaScript records, arrays, strings, numbers,
booleans, and null. Hex numbers remain formatted strings. An integer larger
than JavaScript's safe-integer range raises `MaceError` instead of silently
losing precision. `MaceError.diagnostic` includes available code, category,
source range, and path; `exitCode` remains 1 for compatibility only.

Evaluation defaults to a 30-second deadline; `timeoutMs` may set a different
positive deadline and `signal` accepts an `AbortSignal`. Cancellation and
timeouts reject with `MaceError` and distinct diagnostic codes.

Native binaries must be staged from separately released processor artifacts
before publishing. Staging verifies every library against the published
manifest checksums, and CI runs this package against all eight variants, but
neither has run against a real processor release yet, so publication is
blocked.
