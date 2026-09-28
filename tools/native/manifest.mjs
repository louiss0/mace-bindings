import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const libraryFilenames = {
  darwin: 'libmace_processor.dylib',
  linux: 'libmace_processor.so',
  windows: 'mace_processor.dll',
}

/**
 * Every platform variant the processor release publishes. musl and Windows
 * arm64 are deliberately absent: see `unsupported` in the processor's
 * processor-targets.json. Do not add a target here before the processor
 * release publishes it.
 */
export const supportedTargets = [
  'darwin-amd64',
  'darwin-arm64',
  'linux-amd64-glibc',
  'linux-arm64-glibc',
  'windows-amd64',
]

export function filenameForTarget(target) {
  const [system] = target.split('-')
  const filename = libraryFilenames[system]
  if (!filename) throw new Error(`Unsupported processor target: ${target}`)
  return filename
}

export function releaseUrl(version, asset) {
  return `https://github.com/louiss0/mace/releases/download/processor%2Fv${version}/${asset}`
}

/** The processor release these bindings are built against. */
export async function readPin() {
  const path = fileURLToPath(new URL('./processor.json', import.meta.url))
  const pin = JSON.parse(await readFile(path, 'utf8'))
  if (!pin.version || !pin.manifestSha256) {
    throw new Error('tools/native/processor.json must record version and manifestSha256')
  }
  return pin
}

/**
 * Rejects a manifest that is not the one recorded in the pin. Without this the
 * digests inside a replaced manifest would validate its own artifacts.
 */
export function verifyPinnedManifest(pin, contents) {
  const digest = createHash('sha256').update(contents).digest('hex')
  if (digest !== pin.manifestSha256) {
    throw new Error(
      `Processor manifest for v${pin.version} does not match the pin: expected ${pin.manifestSha256}, got ${digest}`,
    )
  }
  return contents
}

export function parseManifest(manifest) {
  const targets = Array.isArray(manifest?.targets) ? manifest.targets : []
  const byTarget = new Map()
  for (const entry of targets) {
    if (!entry?.target || !entry.artifact || !entry.sha256) {
      throw new Error(`Processor manifest entry is incomplete: ${JSON.stringify(entry)}`)
    }
    byTarget.set(entry.target, entry)
  }
  return { version: manifest.version, targets: byTarget }
}

/** Rejects a release that does not publish every supported variant. */
export function assertCompleteRelease(manifest) {
  const missing = supportedTargets.filter((target) => !manifest.targets.has(target))
  if (missing.length > 0) {
    throw new Error(`Processor release is missing variants: ${missing.join(', ')}`)
  }
  return manifest
}

export function verifyArtifact(target, entry, contents) {
  const digest = createHash('sha256').update(contents).digest('hex')
  if (digest !== entry.sha256) {
    throw new Error(`Checksum mismatch for ${target}: expected ${entry.sha256}, got ${digest}`)
  }
  return contents
}
