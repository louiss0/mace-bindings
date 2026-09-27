# Mace bindings

Official Node, Python, and Dart bindings for the Mace processor. The bindings
are built on the processor's separately built C ABI; the Mace CLI
remains a distinct release. **Do not publish these packages yet:** the release
gates exist, but the platform matrix has not yet run against a real published
processor release.

Libraries are published for `darwin-amd64`, `darwin-arm64`, `windows-amd64`,
`linux-amd64-glibc`, and `linux-arm64-glibc`. `linux-amd64-musl`,
`linux-arm64-musl`, and `windows-arm64` are **not** supported: the musl build
segfaults when called from C, and the Windows arm64 runner has no cross
toolchain. Every binding raises a clear "not published for this platform"
error there instead of trying to load a library. The reasons live in the
processor's `processor-targets.json`.

- `packages/node` — `@code-fixer-23/mace-node` (Koffi)
- `packages/python` — `mace-python` (`ctypes`)
- `packages/dart` — `mace_dart` (Dart FFI)

All three return evaluated records through processor calls. They no longer
implement CLI-only conversion/import functions. Consult each package README
for source/file evaluation, compatibility aliases, and diagnostics.

Nx owns versioning, tagging, and publishing. The old CLI binary-sync workflow
has been removed, and each binding now has its own independent release group
with a `node-v`, `python-v`, or `dart-v` tag. The release workflow delegates
publication to Nx rather than publishing packages itself. Every Nx command
must run with `NX_DAEMON=false`. For local development with a C compiler, run
`nu tools/native/stage-local.nu` from this repo to build and stage the host
library from `../mace`. Then run `npm run check` and `npm run test`. Published
artifacts must instead come from a verified processor release:
`node tools/native/stage-release.mjs <version> [target ...]` downloads the
published `processor-manifest.json`, verifies each library against its pinned
SHA-256, and stages it into every binding. The local staging script is not a
release path. Set `MACE_REPOSITORY` to build the processor from a checkout
that is not a sibling of this repository.

The bindings are MIT licensed; see [LICENSE](LICENSE).
