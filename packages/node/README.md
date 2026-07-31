# @code-fixer-23/mace-node

Official Node.js bindings for Mace.

## Status

This package provides a Node.js API around the `mace` CLI. Supported release
binaries are included in the package and selected automatically for the current
platform. Pass `macePath` when a project needs a different Mace executable.

## Development

This package was scaffolded with Vite via `jpd create vite`.
Scoped npm packages are published with `publishConfig.access = "public"`.

```bash
cd packages/node
jpd install
jpd run build
```

## Usage

```ts
import { json, output } from '@code-fixer-23/mace-node'

const value = await json('./config.mace')
const runtimeValue = await json('./runtime.mace', {
  input: '{ env: "prod", }',
})
const formatted = await output('./config.mace')
```

## API

- `json(path, { input?, macePath?, cwd? }?)`
- `jsonText(path, { input?, macePath?, cwd? }?)`
- `output(path, options?)`
- `nodes(path, options?)`
- `importJson(input, options?)`
- `importYaml(input, options?)`
- `importToml(input, options?)`
- `importFile(path, options?)`

`macePath` is optional; the package uses its bundled platform binary when it is
not provided.
