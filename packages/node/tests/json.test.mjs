import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, test } from 'vitest'

import { importJson, json, jsonText, MaceError, output, transform } from '../dist/index.js'

const macePath = process.env.MACE_PATH
const executeFile = promisify(execFile)
const cleanupTasks = []

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()))
})

function bundledMacePath() {
  const targets = {
    'darwin-x64': 'darwin-amd64',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': 'linux-amd64',
    'linux-arm64': 'linux-arm64',
    'win32-x64': 'windows-amd64',
    'win32-arm64': 'windows-arm64',
  }
  const target = targets[`${process.platform}-${process.arch}`]
  const executable = process.platform === 'win32' ? 'mace.exe' : 'mace'
  return target ? join(import.meta.dirname, '..', 'bin', target, executable) : 'mace'
}

async function createTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'mace-node-test-'))
  cleanupTasks.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('passes runtime input to the Mace CLI', async () => {
  const directory = await createTempDirectory()
  const path = join(directory, 'runtime.mace')
  await writeFile(path, `|===|
schema Runtime: { env: string, };
|===|
[output = 'data', parse = Runtime]
{
  env: $env,
}
`)

  const options = macePath ? { input: '{ env: "prod", }', macePath } : { input: '{ env: "prod", }' }
  const command = macePath ?? bundledMacePath()
  const { stdout } = await executeFile(command, ['output', path])
  console.log('Mace CLI runtime output:', stdout.trim())

  await expect(json(path, options)).resolves.toEqual({ env: 'prod' })
})

test('transforms every value operation into a record', async () => {
  const directory = await createTempDirectory()
  const path = join(directory, 'config.mace')
  await writeFile(path, '{ name: "Mace", }')

  const options = macePath ? { macePath } : {}

  await expect(transform('{ name: "Mace", }', options)).resolves.toEqual({ name: 'Mace' })
  await expect(jsonText(path, options)).resolves.toEqual({ name: 'Mace' })
  const command = macePath ?? bundledMacePath()
  const { stdout } = await executeFile(command, ['output', path])
  console.log('Mace CLI output:', stdout.trim())

  await expect(output(path, options)).resolves.toEqual({ name: 'Mace' })
  await expect(importJson('{"name":"Mace"}', options)).resolves.toEqual({ name: 'Mace' })
})

test('exposes a diagnostic when Mace rejects source', async () => {
  const directory = await createTempDirectory()
  const path = join(directory, 'invalid.mace')
  await writeFile(path, '{ nope: }')

  await expect(json(path, macePath ? { macePath } : {})).rejects.toMatchObject({
    name: 'MaceError',
    message: 'parser: expected expression at 1:9 near "}"',
    diagnostic: {
      category: 'parser',
      message: 'expected expression at 1:9 near "}"',
      range: { start: { line: 1, column: 9 } },
      path,
    },
  })
})
