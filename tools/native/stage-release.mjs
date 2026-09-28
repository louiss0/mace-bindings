#!/usr/bin/env node
// Stages verified processor libraries from a published `processor/vX.Y.Z` release
// into every binding's `bin/` directory. This is the only path that may produce
// release artifacts; `tools/native/stage-local.nu` is for host-only development.
//
// With no arguments it stages the pinned release in tools/native/processor.json,
// which is what CI and the publish path use.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  assertCompleteRelease,
  filenameForTarget,
  parseManifest,
  readPin,
  releaseUrl,
  verifyArtifact,
  verifyPinnedManifest,
} from './manifest.mjs'

const [version, ...requestedTargets] = process.argv.slice(2)

const pin = await readPin()
// An empty argument means "use the pin", which is how CI invokes this.
const requested = version || pin.version
if (!requested) {
  console.error('Usage: node tools/native/stage-release.mjs [processor-version] [target ...]')
  process.exit(2)
}

const stagingDirectories = [
  join('packages', 'node', 'bin'),
  join('packages', 'python', 'src', 'mace_python', 'bin'),
  join('packages', 'dart', 'bin'),
]

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to download ${url}: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const manifestBytes = await download(releaseUrl(requested, 'processor-manifest.json'))

// Only the pinned version is checked against a recorded digest. An explicitly
// requested version is still verified per artifact against the manifest.
if (requested === pin.version) {
  verifyPinnedManifest(pin, manifestBytes)
}

const manifest = assertCompleteRelease(parseManifest(JSON.parse(manifestBytes.toString('utf8'))))
if (manifest.version !== requested) {
  throw new Error(`Processor release ${requested} publishes version ${manifest.version}`)
}

const targets = requestedTargets.length > 0 ? requestedTargets : [...manifest.targets.keys()]
for (const target of targets) {
  const entry = manifest.targets.get(target)
  if (!entry) throw new Error(`Processor release ${requested} does not publish ${target}`)

  const artifact = verifyArtifact(target, entry, await download(releaseUrl(requested, entry.artifact)))
  if (!entry.artifact.includes(target)) {
    throw new Error(`Processor release ${requested} maps ${target} to ${entry.artifact}`)
  }

  for (const directory of stagingDirectories) {
    const destination = join(directory, target)
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, filenameForTarget(target)), artifact)
  }
  console.log(`Staged ${target} from processor v${requested}`)
}
