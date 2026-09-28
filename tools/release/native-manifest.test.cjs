const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')

const repository = join('tools', 'native', 'manifest.mjs')

async function loadModule() {
  return import(pathToFileURL(repository).href)
}

const releaseManifest = {
  version: '1.2.3',
  targets: [
    { target: 'darwin-amd64', artifact: 'mace-processor-darwin-amd64.dylib', sha256: 'a'.repeat(64) },
    { target: 'darwin-arm64', artifact: 'mace-processor/mace-processor-darwin-arm64.dylib', sha256: 'b'.repeat(64) },
    { target: 'linux-amd64-glibc', artifact: 'mace-processor/mace-processor-linux-amd64-glibc.so', sha256: 'c'.repeat(64) },
    { target: 'linux-arm64-glibc', artifact: 'mace-processor/mace-processor-linux-arm64-glibc.so', sha256: 'e'.repeat(64) },
    { target: 'windows-amd64', artifact: 'mace-processor/mace-processor-windows-amd64.dll', sha256: '1'.repeat(64) },
  ],
}

test('accepts a release manifest that publishes every supported variant', async () => {
  const { assertCompleteRelease, parseManifest } = await loadModule()
  const manifest = assertCompleteRelease(parseManifest(releaseManifest))
  assert.equal(manifest.version, '1.2.3')
  assert.equal(manifest.targets.size, 5)
})

test('rejects a release manifest that is missing a variant', async () => {
  const { assertCompleteRelease, parseManifest } = await loadModule()
  const partial = { ...releaseManifest, targets: releaseManifest.targets.slice(1) }
  assert.throws(() => assertCompleteRelease(parseManifest(partial)), /missing variants: darwin-amd64/)
})

test('rejects a manifest entry without a checksum', async () => {
  const { parseManifest } = await loadModule()
  const unchecked = { targets: [{ target: 'windows-amd64', artifact: 'mace-processor/windows-amd64/mace_processor.dll' }] }
  assert.throws(() => parseManifest(unchecked), /entry is incomplete/)
})

test('verifies an artifact against its pinned checksum', async () => {
  const { parseManifest, verifyArtifact } = await loadModule()
  const library = Buffer.from('processor library')
  const digest = createHash('sha256').update(library).digest('hex')
  const manifest = parseManifest({
    version: '1.2.3',
    targets: [{ target: 'windows-amd64', artifact: 'mace-processor/windows-amd64/mace_processor.dll', sha256: digest }],
  })
  const entry = manifest.targets.get('windows-amd64')
  assert.deepEqual(verifyArtifact('windows-amd64', entry, library), library)
  assert.throws(() => verifyArtifact('windows-amd64', entry, Buffer.from('tampered')), /Checksum mismatch/)
})

test('derives platform filenames and download URLs from the release tag', async () => {
  const { filenameForTarget, releaseUrl } = await loadModule()
  assert.equal(filenameForTarget('darwin-arm64'), 'libmace_processor.dylib')
  assert.equal(filenameForTarget('linux-arm64-glibc'), 'libmace_processor.so')
  assert.equal(filenameForTarget('windows-amd64'), 'mace_processor.dll')
  assert.throws(() => filenameForTarget('plan9-amd64'), /Unsupported processor target/)
  assert.equal(
    releaseUrl('1.2.3', 'processor-manifest.json'),
    'https://github.com/louiss0/mace/releases/download/processor%2Fv1.2.3/processor-manifest.json',
  )
})

test('rejects a manifest that does not match the recorded pin', async () => {
  const { readPin, verifyPinnedManifest } = await loadModule()
  const pin = await readPin()
  const contents = Buffer.from(JSON.stringify(releaseManifest))
  assert.throws(() => verifyPinnedManifest(pin, contents), /does not match the pin/)
  assert.throws(() => verifyPinnedManifest({ version: '0.1.0', manifestSha256: 'a'.repeat(64) }, contents), /does not match the pin/)
})

test('the pin names a real processor release layout', async () => {
  const { readPin } = await loadModule()
  const pin = await readPin()
  assert.match(pin.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pin.release, `processor/v${pin.version}`)
  assert.match(pin.manifestSha256, /^[0-9a-f]{64}$/)
  assert.ok(pin.repository, 'the pin must name the repository it downloads from')
})

test('the bindings agree on the platform target names they publish for', async () => {
  const { supportedTargets } = await loadModule()
  assert.deepEqual([...supportedTargets].sort(), [
    'darwin-amd64', 'darwin-arm64', 'linux-amd64-glibc', 'linux-arm64-glibc', 'windows-amd64',
  ])
  for (const dropped of ['linux-amd64-musl', 'linux-arm64-musl', 'windows-arm64']) {
    assert.ok(!supportedTargets.includes(dropped), `${dropped} must not be advertised before the release publishes it`)
  }
})

test('each binding resolves the same platform target names', async () => {
  const { supportedTargets } = await loadModule()
  const nodeSource = readFileSync(join('packages', 'node', 'src', 'index.ts'), 'utf8')
  const pythonTargets = JSON.parse(
    readFileSync(join('packages', 'python', 'native_targets.json'), 'utf8'),
  )
  const pythonBuild = readFileSync(join('packages', 'python', 'hatch_build.py'), 'utf8')

  // The Python build must read the shared mapping, not repeat it, so a wheel can
  // never be tagged for a platform the hook would reject.
  assert.match(pythonBuild, /native_targets\.json/)

  for (const target of supportedTargets) {
    const [system, arch] = target.split('-')
    const platform = `${system === 'windows' ? 'win32' : system}-${arch === 'amd64' ? 'x64' : 'arm64'}`
    if (system === 'linux') {
      assert.ok(
        nodeSource.includes(`'${platform}': \`${system}-${arch}-\${libc}\``),
        `node is missing ${target}`,
      )
    } else {
      assert.ok(nodeSource.includes(`'${platform}': '${target}'`), `node is missing ${target}`)
    }
    assert.ok(pythonTargets[target], `python is missing ${target}`)
    assert.match(pythonTargets[target].wheelTag, /^[a-z0-9_]+$/)
  }
  assert.deepEqual(Object.keys(pythonTargets).sort(), [...supportedTargets].sort())

  // Linux targets are only correct if Node detects the C library it will run on.
  assert.ok(nodeSource.includes("'glibc' : 'musl'"), 'node does not select a Linux C library')
})
