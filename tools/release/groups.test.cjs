const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

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

// The release workflow proves every publish command works before touching a
// registry. An executor such as @nx/js:release-publish ignores NX_DRY_RUN, so
// the verification pass would publish for real.
test('every publish target is dry-run safe', () => {
  for (const project of ['node', 'python', 'dart']) {
    const definition = JSON.parse(readFileSync(join('packages', project, 'project.json'), 'utf8'))
    const publish = definition.targets['nx-release-publish']
    assert.equal(publish.executor, undefined, `${project} must not use an executor that ignores NX_DRY_RUN`)
    assert.match(publish.command, /tools\/release\/publish-/, `${project} must publish through a script`)
  }

  for (const script of ['publish-node.cjs', 'publish-python.cjs', 'publish-dart.cjs']) {
    const source = readFileSync(join('tools', 'release', script), 'utf8')
    assert.match(source, /NX_DRY_RUN/, `${script} must honour NX_DRY_RUN`)
  }
})

test('a dry run publishes nothing', () => {
  const output = execFileSync('node', [join('tools', 'release', 'publish-node.cjs')], {
    env: { ...process.env, NX_DRY_RUN: 'true' },
    encoding: 'utf8',
  })
  assert.match(output, /would publish @code-fixer-23\/mace-node \d+\.\d+\.\d+/)
})

test('each binding versions independently with its own flat release tag', () => {
  assert.deepEqual(Object.keys(workspace.release.groups).sort(), releases.map(([name]) => name).sort())
  for (const [name, project, pattern] of releases) {
    assert.deepEqual(workspace.release.groups[name].projects, [project])
    assert.equal(workspace.release.groups[name].projectsRelationship, 'independent')
    assert.equal(workspace.release.groups[name].releaseTag.pattern, pattern)
  }
})
