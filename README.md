# Mace bindings

This repository contains the official language bindings for Mace. Mace is a
new deterministic, strongly typed configuration language created in 2026.
The bindings provide native package APIs around the released `mace` CLI.

## Packages

- `packages/node` — `@code-fixer-23/mace-node`
- `packages/python` — `mace-python`

Both packages are released at version 1.0.0 for the Mace 1.0.0 release. The
CLI is installed separately; each package accepts a custom executable path for
projects that do not expose `mace` on `PATH`.

## Development

Build and test each package from its package directory. The package tests use a
freshly built Mace binary through `MACE_PATH`.

## License

Mace bindings are distributed under the [MIT License](./LICENSE).
