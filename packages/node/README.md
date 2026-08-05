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
import { json, output, transform } from '@code-fixer-23/mace-node'

const value = await json('./config.mace')
const inlineValue = await transform('{ name: "Mace", }')
const runtimeValue = await json('./runtime.mace', {
  input: '{ env: "prod", }',
})
const outputRecord = await output('./config.mace')
```

## API

- `json(path, { input?, macePath?, cwd? }?)` → `Promise<MaceRecord>`
- `transform(source, { input?, macePath?, cwd? }?)` → `Promise<MaceRecord>`
- `jsonText(path, { input?, macePath?, cwd? }?)` → `Promise<MaceRecord>`
- `output(path, options?)` → `Promise<MaceRecord>`
- `importJson(input, options?)` → `Promise<MaceRecord>`
- `importYaml(input, options?)` → `Promise<MaceRecord>`
- `importToml(input, options?)` → `Promise<MaceRecord>`
- `importFile(path, options?)` → `Promise<MaceRecord>`

`macePath` is optional; the package uses its bundled platform binary when it is
not provided.

## Records and errors

`transform` is the Mace-string transformer: it writes source to a temporary
`.mace` file, asks the CLI to parse and evaluate it, then converts the CLI JSON
output into a native `MaceRecord`. `jsonText` is retained as an alias for
`json`; `output` transforms the CLI’s canonical Mace source; and `import*`
transforms the generated Mace source. A `MaceRecord` contains strings, numbers,
booleans, nested records, and arrays.

CLI failures reject with `MaceError`. Alongside `message` and `exitCode`, its
`diagnostic` provides a best-effort structured view of the CLI stderr:
`category`, `code`, `message`, `range.start.line`, `range.start.column`, and
`path`. The current CLI text protocol does not always provide every field, so
`category`, `code`, `range`, and `path` are optional.
