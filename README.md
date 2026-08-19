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

## Nx commands and releases

Nx manages both bindings as a fixed release group: each release gives the npm
and PyPI packages the same version and creates a `v{version}` Git tag. The Nx
wrapper (`nx`/`nx.bat`) is committed with the workspace and installs the pinned
Nx plugins on first use.

Install `pnpm` for the Node binding and [uv](https://docs.astral.sh/uv/) for
the Python binding, then run:

```bash
npm run check
npm run test
npm run build
npm run release:dry-run -- patch --skip-publish
```

Release from a clean, validated branch with `npm run release -- patch`. Nx
updates both manifests, writes `CHANGELOG.md`, commits, and tags the release.
It then runs the Node npm publish target and the Python `uv publish` target.
Configure npm authentication with `npm login` or an `.npmrc` before releasing,
and configure PyPI authentication through uv (for example,
`UV_PUBLISH_TOKEN`). Nx does not push the release commit or tag; review it and
push it explicitly after publishing succeeds.

## License

Mace bindings are distributed under the [MIT License](./LICENSE).
