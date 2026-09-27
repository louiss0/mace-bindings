# Mace bindings

Official Node, Python, and Dart bindings for the Mace processor. The bindings
are migrating from subprocess calls to the processor's separately built C ABI;
the Mace CLI will remain a distinct release. **Do not publish these packages
yet:** verified native artifact staging, eight-variant tests, full cancellation
coverage, and release workflows are still being migrated.

- `packages/node` — `@code-fixer-23/mace-node` (Koffi)
- `packages/python` — `mace-python` (`ctypes`)
- `packages/dart` — `mace_dart` (Dart FFI)

All three return evaluated records through processor calls. They no longer
implement CLI-only conversion/import functions. Consult each package README
for source/file evaluation, compatibility aliases, and diagnostics.

Nx manages versioning and publishing. The old CLI binary-sync workflow has
been removed; the existing fixed release group is **not yet suitable** for
independent processor and binding releases. Every Nx command must run with `NX_DAEMON=false`.
For local development with a C compiler, run `nu tools/native/stage-local.nu`
from this repo to build and stage the host library from `../mace`. Then run
`npm run check` and `npm run test`. Published artifacts must instead come from
verified processor releases; the local staging script is not a release path.

The bindings are MIT licensed; see [LICENSE](LICENSE).
