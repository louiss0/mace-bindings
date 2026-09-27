const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')

const workspace = JSON.parse(readFileSync('nx.json', 'utf8'))
const releases = [
  ['node', 'mace-node', 'node-v{version}'],
  ['python', 'mace-python', 'python-v{version}'],
  ['dart', 'mace-dart', 'dart-v{version}'],
]

test('Actions delegates publication to Nx instead of directly publishing packages', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /nxw\.js release publish/)
  assert.doesNotMatch(workflow, /run:\s*(?:pnpm publish|uv publish|dart pub publish)/)
})

test('each binding versions independently with its own flat release tag', () => {
  assert.deepEqual(Object.keys(workspace.release.groups).sort(), releases.map(([name]) => name).sort())
  for (const [name, project, pattern] of releases) {
    assert.deepEqual(workspace.release.groups[name].projects, [project])
    assert.equal(workspace.release.groups[name].projectsRelationship, 'independent')
    assert.equal(workspace.release.groups[name].releaseTag.pattern, pattern)
  }
})
