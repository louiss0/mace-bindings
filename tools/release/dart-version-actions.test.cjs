const assert = require('node:assert/strict')
const test = require('node:test')

const DartVersionActions = require('./dart-version-actions.cjs')

function createTree(files) {
  return {
    exists(path) {
      return files.has(path)
    },
    read(path, encoding) {
      const value = files.get(path)
      return encoding ? value : Buffer.from(value)
    },
    write(path, content) {
      files.set(path, content)
    },
  }
}

test('reads and updates the project version in pubspec.yaml', async () => {
  const files = new Map([
    [
      'packages/dart/pubspec.yaml',
      'name: mace_dart\nversion: 1.0.0\n',
    ],
  ])
  const actions = new DartVersionActions(
    {},
    { name: 'mace-dart', data: { root: 'packages/dart' } },
    { manifestRootsToUpdate: [], preserveLocalDependencyProtocols: true },
  )
  const tree = createTree(files)

  await actions.init(tree)

  assert.deepEqual(await actions.readCurrentVersionFromSourceManifest(tree), {
    currentVersion: '1.0.0',
    manifestPath: 'packages/dart/pubspec.yaml',
  })
  await actions.updateProjectVersion(tree, '1.0.1')

  assert.match(files.get('packages/dart/pubspec.yaml'), /version: 1\.0\.1/)
})

test('derives a prerelease patch version', async () => {
  const actions = new DartVersionActions(
    {},
    { name: 'mace-dart', data: { root: 'packages/dart' } },
    { manifestRootsToUpdate: [], preserveLocalDependencyProtocols: true },
  )

  const result = await actions.calculateNewVersion('1.0.0', 'prepatch', 'user-input', {}, 'rc')

  assert.equal(result.newVersion, '1.0.1-rc.0')
})
