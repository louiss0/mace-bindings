const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const workspace = JSON.parse(readFileSync('nx.json', 'utf8'))
const releases = [
  ['node', 'mace-node', 'node-v{version}'],
  ['python', 'mace-python', 'python-v{version}'],
  ['dart', 'mace-dart', 'dart-v{version}'],
]

test('Actions delegates publication to Nx instead of directly publishing packages', () => {
  for (const workflow of ['release-binding.yml', 'publish-dart.yml']) {
    const source = readFileSync(join('.github', 'workflows', workflow), 'utf8')
    assert.match(source, /nxw\.js release publish/, `${workflow} must publish through Nx`)
    assert.doesNotMatch(
      source,
      /run:\s*(?:pnpm publish|uv publish|dart pub publish)\b/,
      `${workflow} must not publish a package directly`,
    )
  }
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

test('a single binding can be released on its own', () => {
  const workflow = readFileSync('.github/workflows/release-binding.yml', 'utf8')
  const options = workflow.match(/options:\n(?:\s+-\s+\w+\n)+/)[0]
  for (const binding of ['node', 'python', 'dart', 'all']) {
    assert.match(options, new RegExp(`- ${binding}\\b`), `${binding} is not selectable`)
  }
  // Each publish is scoped to its group, so selecting one never publishes another.
  assert.match(workflow, /release publish --groups=node --nxBail/)
  assert.match(workflow, /release publish --groups=python --nxBail/)
  assert.match(workflow, /release version "\$specifier" \\\n\s+--groups="\$GROUPS"/)
})

// pub.dev rejects any publish that is not triggered by a matching tag push, so
// the Dart publish must live in its own tag-triggered workflow.
test('the Dart publish runs in a tag-triggered workflow with no pub.dev secret', () => {
  const publish = readFileSync('.github/workflows/publish-dart.yml', 'utf8')
  const dispatch = readFileSync('.github/workflows/release-binding.yml', 'utf8')

  assert.match(publish, /tags:\n\s+- 'dart-v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'/)
  assert.match(publish, /id-token: write/)
  assert.match(publish, /dart-lang\/setup-dart@v1/)
  assert.match(publish, /release publish --groups=dart --nxBail/)
  assert.doesNotMatch(publish, /PUB_CREDENTIALS|pub-credentials\.json|api_token/)

  // The dispatch workflow triggers it by pushing the tag, never by publishing.
  assert.match(dispatch, /git push origin \$\(git tag --list 'dart-v\*'\)/)
  assert.doesNotMatch(dispatch, /release publish --groups=dart/)
})

// The superseded all-in-one release workflow was removed. Publishing now goes
// through release-binding.yml (node, python, dart, or all) and the tag-triggered
// publish-dart.yml. None of them may reintroduce a pub.dev credentials secret:
// pub.dev rejects workflow_dispatch publishes, so the credential is always
// minted from id-token by setup-dart.
test('the publishing workflows carry no pub.dev credentials secret', () => {
  for (const workflow of ['release-binding.yml', 'publish-dart.yml', 'ci.yml']) {
    const source = readFileSync(join('.github', 'workflows', workflow), 'utf8')
    assert.doesNotMatch(source, /PUB_CREDENTIALS/, `${workflow} references a pub.dev secret`)
    assert.doesNotMatch(source, /pub-credentials\.json/, `${workflow} writes pub credentials`)
  }
})

// The old all-in-one workflow published every binding from a workflow_dispatch
// run, which pub.dev rejects, and needed a pub.dev secret that cannot exist.
// release-binding.yml replaced it; it must not come back.
test('the superseded all-in-one release workflow stays deleted', () => {
  assert.equal(existsSync(join('.github', 'workflows', 'release.yml')), false)
})

test('each binding versions independently with its own flat release tag', () => {
  assert.deepEqual(Object.keys(workspace.release.groups).sort(), releases.map(([name]) => name).sort())
  for (const [name, project, pattern] of releases) {
    assert.deepEqual(workspace.release.groups[name].projects, [project])
    assert.equal(workspace.release.groups[name].projectsRelationship, 'independent')
    assert.equal(workspace.release.groups[name].releaseTag.pattern, pattern)
  }
})
