import { createHash } from 'node:crypto'

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
