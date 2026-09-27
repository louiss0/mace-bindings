import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import koffi from 'koffi'

import { createExecutionGate } from './execution.ts'

export type RunOptions = { cwd?: string; timeoutMs?: number; signal?: AbortSignal }
export type JsonOptions = RunOptions & { input?: string }
export type MaceValue = string | number | boolean | null | MaceValue[] | { [field: string]: MaceValue }
export type MaceRecord = { [field: string]: MaceValue }
export type MacePosition = { line: number; column: number }
export type MaceSourceRange = { start: MacePosition; end?: MacePosition }
export type MaceDiagnostic = {
  category?: string
  code?: string
  message: string
  range?: MaceSourceRange
  path?: string
}

export class MaceError extends Error {
  readonly exitCode = 1
  readonly diagnostic: MaceDiagnostic

  constructor(message: string, diagnostic: MaceDiagnostic = { message }) {
    super(message)
    this.name = 'MaceError'
    this.diagnostic = diagnostic
  }
}

async function loadLibrary() {
  const libc = (process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime ? 'glibc' : 'musl'
  const targets: Record<string, string> = {
    'darwin-x64': 'darwin-amd64',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': `linux-amd64-${libc}`,
    'linux-arm64': `linux-arm64-${libc}`,
    'win32-x64': 'windows-amd64',
    'win32-arm64': 'windows-arm64',
  }
  const target = targets[`${process.platform}-${process.arch}`]
  if (!target) throw new MaceError('Unsupported native processor platform')
  const filename = process.platform === 'win32' ? 'mace_processor.dll'
    : process.platform === 'darwin' ? 'libmace_processor.dylib' : 'libmace_processor.so'
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', target, filename)
  try {
    await access(path)
  } catch {
    throw new MaceError(`Bundled processor library is missing: ${path}`)
  }
  const library = koffi.load(path)
  const bind = (signature: string) => library.func(signature)
  const abiMajor = bind('uint32_t mace_abi_major()')
  if (abiMajor() !== 1) throw new MaceError(`Incompatible processor ABI: ${abiMajor()}`)
  return {
    file: bind('uint64_t mace_process_file_with_request(uint64_t request, const char *path, const char *workspace, const char *input)'),
    source: bind('uint64_t mace_process_source_with_request(uint64_t request, const char *source, const char *workspace, const char *input)'),
    newRequest: bind('uint64_t mace_request_new(uint32_t timeout_ms)'),
    cancelRequest: bind('void mace_request_cancel(uint64_t request)'),
    freeRequest: bind('void mace_request_free(uint64_t request)'),
    root: bind('uint64_t mace_result_root(uint64_t result)'),
    error: bind('void *mace_result_error(uint64_t result)'),
    errorCode: bind('void *mace_result_error_code(uint64_t result)'),
    errorKind: bind('void *mace_result_error_kind(uint64_t result)'),
    errorLine: bind('uint32_t mace_result_error_line(uint64_t result)'),
    errorColumn: bind('uint32_t mace_result_error_column(uint64_t result)'),
    errorEndLine: bind('uint32_t mace_result_error_end_line(uint64_t result)'),
    errorEndColumn: bind('uint32_t mace_result_error_end_column(uint64_t result)'),
    freeResult: bind('void mace_result_free(uint64_t result)'),
    stringLength: bind('uint64_t mace_string_length(void *text)'),
    freeString: bind('void mace_string_free(void *text)'),
    kind: bind('uint32_t mace_value_kind(uint64_t value)'),
    integer: bind('int64_t mace_value_int(uint64_t value)'),
    decimal: bind('double mace_value_float(uint64_t value)'),
    boolean: bind('uint8_t mace_value_boolean(uint64_t value)'),
    string: bind('void *mace_value_string(uint64_t value)'),
    stringLengthOfValue: bind('uint64_t mace_value_string_length(uint64_t value)'),
    arrayLength: bind('uint64_t mace_value_array_length(uint64_t value)'),
    arrayItem: bind('uint64_t mace_value_array_item(uint64_t value, uint64_t index)'),
    recordLength: bind('uint64_t mace_value_record_length(uint64_t value)'),
    recordKey: bind('void *mace_value_record_key(uint64_t value, uint64_t index)'),
    recordKeyLength: bind('uint64_t mace_value_record_key_length(uint64_t value, uint64_t index)'),
    recordValue: bind('uint64_t mace_value_record_value(uint64_t value, uint64_t index)'),
  }
}

type Native = Awaited<ReturnType<typeof loadLibrary>>
let loaded: Promise<Native> | undefined

/** Matches the libuv thread pool that serves the asynchronous native calls. */
const nativeConcurrency = 4
const gate = createExecutionGate(nativeConcurrency)

function readString(native: Native, pointer: bigint | null, length?: number): string | undefined {
  if (!pointer) return undefined
  try {
    return Buffer.from(koffi.view(pointer, length ?? native.stringLength(pointer))).toString('utf8')
  } finally {
    native.freeString(pointer)
  }
}

function readValue(native: Native, value: number | bigint): MaceValue {
  switch (native.kind(value)) {
    case 0:
    case 1:
      return null
    case 2:
    case 5:
    case 6:
      return readString(native, native.string(value), native.stringLengthOfValue(value)) ?? ''
    case 3: {
      const integer = native.integer(value)
      if (!Number.isSafeInteger(integer)) throw new MaceError('Mace integer exceeds the JavaScript safe integer range')
      return integer
    }
    case 4:
      return native.decimal(value)
    case 7:
      return Boolean(native.boolean(value))
    case 8:
      return Array.from({ length: native.arrayLength(value) }, (_, index) => readValue(native, native.arrayItem(value, index)))
    case 9:
      return Object.fromEntries(Array.from({ length: native.recordLength(value) }, (_, index) => [
        readString(native, native.recordKey(value, index), native.recordKeyLength(value, index)),
        readValue(native, native.recordValue(value, index)),
      ])) as MaceRecord
    default:
      throw new MaceError(`Unsupported Mace value kind: ${native.kind(value)}`)
  }
}

function readResult(native: Native, result: number | bigint, path?: string): MaceRecord {
  try {
    const message = readString(native, native.error(result))
    if (message != null) {
      const kind = readString(native, native.errorKind(result))
      const startLine = native.errorLine(result)
      const endLine = native.errorEndLine(result)
      const diagnostic: MaceDiagnostic = {
        message,
        category: ({ syntax: 'parser', lexical: 'lexer' } as Record<string, string>)[kind ?? ''] ?? kind,
        code: readString(native, native.errorCode(result)),
        path,
        range: startLine ? {
          start: { line: startLine, column: native.errorColumn(result) },
          ...(endLine ? { end: { line: endLine, column: native.errorEndColumn(result) } } : {}),
        } : undefined,
      }
      throw new MaceError(message, diagnostic)
    }
    return readValue(native, native.root(result)) as MaceRecord
  } finally {
    native.freeResult(result)
  }
}

async function evaluate(operation: 'file' | 'source', source: string, options: JsonOptions, sourceName?: string): Promise<MaceRecord> {
  loaded ??= loadLibrary()
  const native = await loaded
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 0xffffffff)) {
    throw new MaceError('timeoutMs must be a positive 32-bit integer')
  }
  const request = native.newRequest(options.timeoutMs ?? 0)
  return gate.run(() => new Promise<MaceRecord>((resolve, reject) => {
    const cancel = () => native.cancelRequest(request)
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    native[operation].async(request, source, options.cwd ?? process.cwd(), options.input ?? null, (error: Error | null, result: number) => {
      options.signal?.removeEventListener('abort', cancel)
      try {
        if (error) throw new MaceError(error.message)
        resolve(readResult(native, result, sourceName))
      } catch (failure) {
        reject(failure)
      } finally {
        native.freeRequest(request)
      }
    })
  }))
}

export async function json(path: string, options: JsonOptions = {}): Promise<MaceRecord> {
  return evaluate('file', path, options, path)
}

export async function transform(source: string, options: JsonOptions & { sourceName?: string } = {}): Promise<MaceRecord> {
  return evaluate('source', source, options, options.sourceName)
}

/** @deprecated Use json. */
export async function jsonText(path: string, options: JsonOptions = {}): Promise<MaceRecord> {
  return json(path, options)
}

/** @deprecated Use json. */
export async function output(path: string, options: RunOptions = {}): Promise<MaceRecord> {
  return json(path, options)
}
