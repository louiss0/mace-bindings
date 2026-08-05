import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseMace } from './parser.js'

export type RunOptions = {
  macePath?: string
  cwd?: string
}

export type JsonOptions = RunOptions & {
  input?: string
}

export type MaceValue = string | number | boolean | MaceValue[] | { [field: string]: MaceValue }

export type MaceRecord = { [field: string]: MaceValue }

export type MacePosition = {
  line: number
  column: number
}

export type MaceSourceRange = {
  start: MacePosition
}

export type MaceDiagnostic = {
  category?: string
  code?: string
  message: string
  range?: MaceSourceRange
  path?: string
}

export class MaceError extends Error {
  readonly exitCode: number
  readonly diagnostic: MaceDiagnostic

  constructor(message: string, exitCode = 1, diagnostic = diagnosticFromMessage(message)) {
    super(message)
    this.name = 'MaceError'
    this.exitCode = exitCode
    this.diagnostic = diagnostic
  }
}

export async function json(path: string, options: JsonOptions = {}): Promise<MaceRecord> {
  const source = await runMace(['output', path], options)
  return parse(source, options)
}

export function parse(source: string, options: JsonOptions = {}): MaceRecord {
  try {
    return parseMace(source, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new MaceError(message, 1, diagnosticFromMessage(message))
  }
}

export async function transform(source: string, options: JsonOptions = {}): Promise<MaceRecord> {
  return withTempFile('source.mace', source, async (path) => {
    const formatted = await runMace(['output', path], options)
    return parse(formatted, options)
  })
}

export async function jsonText(path: string, options: JsonOptions = {}): Promise<MaceRecord> {
  return json(path, options)
}

export async function output(path: string, options: RunOptions = {}): Promise<MaceRecord> {
  const source = await runMace(['output', path], options)
  return parse(source, options)
}

export async function importJson(input: string, options: RunOptions = {}): Promise<MaceRecord> {
  return withTempFile('input.json', input, (path) => importFile(path, options))
}

export async function importYaml(input: string, options: RunOptions = {}): Promise<MaceRecord> {
  return withTempFile('input.yaml', input, (path) => importFile(path, options))
}

export async function importToml(input: string, options: RunOptions = {}): Promise<MaceRecord> {
  return withTempFile('input.toml', input, (path) => importFile(path, options))
}

export async function importFile(path: string, options: RunOptions = {}): Promise<MaceRecord> {
  const directory = await mkdtemp(join(tmpdir(), 'mace-node-import-'))
  try {
    const output = await runMace(['import', path, '--output-dir', directory], options)
    const lines = output.trim().split(/\r?\n/).filter(Boolean)
    const outputPath = lines.find((line) => line.endsWith('.mace'))
    if (!outputPath) {
      throw new MaceError('import did not report an output file')
    }

    const source = await readFile(outputPath, 'utf8')
    return await transform(source, options)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function withTempFile<Result>(name: string, contents: string, action: (path: string) => Promise<Result>): Promise<Result> {
  const directory = await mkdtemp(join(tmpdir(), 'mace-node-'))
  const path = join(directory, name)

  try {
    await writeFile(path, contents, 'utf8')
    return await action(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

declare const __dirname: string | undefined

async function resolveBundledMacePath(): Promise<string | undefined> {
  const targets: Record<string, string> = {
    'darwin-x64': 'darwin-amd64',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': 'linux-amd64',
    'linux-arm64': 'linux-arm64',
    'win32-x64': 'windows-amd64',
    'win32-arm64': 'windows-arm64',
  }
  const target = targets[`${process.platform}-${process.arch}`]
  if (!target) {
    return undefined
  }

  const executable = process.platform === 'win32' ? 'mace.exe' : 'mace'
  const moduleDirectory = typeof __dirname === 'string'
    ? __dirname
    : dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1'))
  const path = join(moduleDirectory, '..', 'bin', target, executable)
  try {
    await access(path)
    return path
  } catch {
    return undefined
  }
}

async function runMace(args: string[], options: RunOptions): Promise<string> {
  const command = options.macePath ?? await resolveBundledMacePath() ?? 'mace'

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      reject(new MaceError(error.message))
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      const message = stderr.trim() || `mace exited with code ${code ?? 1}`
      reject(new MaceError(message, code ?? 1, diagnosticFromMessage(message, sourcePathFromArgs(args))))
    })
  })
}

function diagnosticFromMessage(message: string, path?: string): MaceDiagnostic {
  const firstLine = message.trim().split(/\r?\n/, 1)[0] || 'mace exited with an unknown error'
  const categoryMatch = /^(?<category>[^:\s]+):\s*(?<message>.*)$/.exec(firstLine)
  const diagnosticMessage = categoryMatch?.groups?.message || firstLine
  const positionMatch = /\bat (?<line>\d+):(?<column>\d+)\b/.exec(diagnosticMessage)
  const codeMatch = /\b(?<code>mace\.[a-z0-9][a-z0-9.-]*)\b/i.exec(diagnosticMessage)

  return {
    ...(categoryMatch?.groups?.category ? { category: categoryMatch.groups.category } : {}),
    ...(codeMatch?.groups?.code ? { code: codeMatch.groups.code } : {}),
    message: diagnosticMessage,
    ...(positionMatch?.groups
      ? {
          range: {
            start: {
              line: Number(positionMatch.groups.line),
              column: Number(positionMatch.groups.column),
            },
          },
        }
      : {}),
    ...(path ? { path } : {}),
  }
}

function sourcePathFromArgs(args: string[]): string | undefined {
  return ['output', 'import'].includes(args[0]) ? args[1] : undefined
}
