import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { json, jsonText, output, transform } from '../src/index.ts'

const cleanupTasks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()))
})

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), 'mace-node-test-'))
  cleanupTasks.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('evaluates source without spawning the CLI', async () => {
  const cwd = await createWorkspace()
  await expect(transform("[output = 'data']\n{ name: 'Ada', score: 42, tags: ['a', 'b'], }", { cwd }))
    .resolves.toEqual({ name: 'Ada', score: 42, tags: ['a', 'b'] })
})

test('evaluates files and a Mace input record', async () => {
  const cwd = await createWorkspace()
  const path = join(cwd, 'config.mace')
  await writeFile(path, "|===|\nschema Runtime: { env: string, };\n|===|\n[output = 'data', parse = Runtime]\n{ env: $env, }")
  await expect(json(path, { cwd, input: '{ env: "prod", }' })).resolves.toEqual({ env: 'prod' })
  await expect(jsonText(path, { cwd, input: '{ env: "prod", }' })).resolves.toEqual({ env: 'prod' })
})

test('retains deprecated output alias', async () => {
  const cwd = await createWorkspace()
  const path = join(cwd, 'config.mace')
  await writeFile(path, "[output = 'data']\n{ enabled: true, }")
  await expect(output(path, { cwd })).resolves.toEqual({ enabled: true })
})

test('exposes a structured diagnostic', async () => {
  const cwd = await createWorkspace()
  const path = join(cwd, 'invalid.mace')
  await writeFile(path, '{ nope: }')
  await expect(json(path, { cwd })).rejects.toMatchObject({
    name: 'MaceError',
    diagnostic: { category: 'parser', range: { start: { line: 1, column: 9 } }, path },
  })
})

test('cancels a stalled remote import without blocking Node', async () => {
  const cwd = await createWorkspace()
  const server = createServer(() => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to bind test server')
  const signal = new AbortController()
  try {
    const evaluation = transform(`|===|\nfrom 'http://127.0.0.1:${address.port}/types.mace' import Age;\n|===|\n[output = 'data']\n{ age: 42, }`, {
      cwd, signal: signal.signal,
    })
    setTimeout(() => signal.abort(), 100)
    await expect(evaluation).rejects.toMatchObject({
      name: 'MaceError', diagnostic: { code: 'mace.runtime.cancelled' },
    })
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('reports a timeout with its own diagnostic code', async () => {
  const cwd = await createWorkspace()
  const server = createServer(() => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to bind test server')
  try {
    await expect(transform(`|===|\nfrom 'http://127.0.0.1:${address.port}/types.mace' import Age;\n|===|\n[output = 'data']\n{ age: 42, }`, {
      cwd, timeoutMs: 100,
    })).rejects.toMatchObject({
      name: 'MaceError', diagnostic: { code: 'mace.runtime.timeout' },
    })
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('rejects unsafe JavaScript integers rather than losing precision', async () => {
  const cwd = await createWorkspace()
  await expect(transform("[output = 'data']\n{ value: 9007199254740993, }", { cwd }))
    .rejects.toMatchObject({ name: 'MaceError' })
})
