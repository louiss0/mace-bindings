import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { importJson, json, jsonText, MaceError, output, parse, transform } from '../dist/index.js'

const macePath = process.env.MACE_PATH

test('passes runtime input to the Mace CLI', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mace-node-test-'))
  context.after(() => rm(directory, { recursive: true, force: true }))

  const path = join(directory, 'runtime.mace')
  await writeFile(path, `|===|
schema Runtime: { env: string, };
|===|
[output = 'data', parse = Runtime]
{
  env: $env,
}
`)

  const options = { input: '{ env: "prod", }' }
  if (macePath) {
    options.macePath = macePath
  }

  const result = await json(path, options)

  assert.deepEqual(result, { env: 'prod' })
})

test('transforms every value operation into a record', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mace-node-test-'))
  context.after(() => rm(directory, { recursive: true, force: true }))

  const path = join(directory, 'config.mace')
  await writeFile(path, '{ name: "Mace", }')

  const options = macePath ? { macePath } : {}

  assert.deepEqual(parse(`|===|
int base = 2 + 2;
|===|
{ name: "Mace", total: base, }`), { name: 'Mace', total: 4 })
  assert.deepEqual(await transform('{ name: "Mace", }', options), { name: 'Mace' })
  assert.deepEqual(await jsonText(path, options), { name: 'Mace' })
  assert.deepEqual(await output(path, options), { name: 'Mace' })
  assert.deepEqual(await importJson('{"name":"Mace"}', options), { name: 'Mace' })
})

test('exposes a diagnostic when Mace rejects source', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'mace-node-test-'))
  context.after(() => rm(directory, { recursive: true, force: true }))

  const path = join(directory, 'invalid.mace')
  await writeFile(path, '{ nope: }')

  await assert.rejects(json(path, macePath ? { macePath } : {}), (error) => {
    assert.ok(error instanceof MaceError)
    assert.equal(error.message, 'parser: expected expression at 1:9 near "}"')
    assert.equal(error.diagnostic.category, 'parser')
    assert.equal(error.diagnostic.message, 'expected expression at 1:9 near "}"')
    assert.deepEqual(error.diagnostic.range, { start: { line: 1, column: 9 } })
    assert.equal(error.diagnostic.path, path)
    return true
  })
})
