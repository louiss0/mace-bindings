# Mace bindings

This repository contains the official language bindings for Mace. Mace is a
new deterministic, strongly typed configuration language created in 2026.
The bindings provide native package APIs around the released `mace` CLI. A
workflow synchronizes all supported Mace release binaries into `bin/`, and
published packages select the matching binary for the current platform.

## Packages

- `packages/node` — `@code-fixer-23/mace-node`
- `packages/python` — `mace-python`

Both packages are released at version 1.0.0 for the Mace 1.0.0 release. Each
package includes the supported platform binaries and accepts a custom
executable path when a project needs a different Mace build.

## Development

Build and test each package from its package directory. The package tests use a
freshly built Mace binary through `MACE_PATH`.

## License

Mace bindings are distributed under the [MIT License](./LICENSE).
