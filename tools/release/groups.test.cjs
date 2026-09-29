const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const workspace = JSON.parse(readFileSync('nx.json', 'utf8'))

/**
 * Reads a checked-out file with normalised line endings. Git can check out CRLF
 * on Windows runners, and a multi-line regex written for LF would fail there and
 * only there.
 */
function readSource(...parts) {
  return readFileSync(join(...parts), 'utf8').replaceAll('\r\n', '\n')
}

const releases = [
  ['node', 'mace-node', 'node-v{version}'],
  ['python', 'mace-python', 'python-v{version}'],
  ['dart', 'mace-dart', 'dart-v{version}'],
]

test('Actions delegates publication to Nx instead of directly publishing packages', () => {
  const workflow = readSource('.github', 'workflows', 'release-binding.yml')
  assert.match(workflow, /nxw\.js release publish/)
  assert.doesNotMatch(workflow, /run:\s*(?:pnpm publish|uv publish|dart pub publish)\b/)
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
  const workflow = readSource('.github', 'workflows', 'release-binding.yml')
  const options = workflow.match(/options:\n(?:\s+-\s+\w+\n)+/)[0]
  for (const binding of ['node', 'python', 'dart', 'all']) {
    assert.match(options, new RegExp(`- ${binding}\\b`), `${binding} is not selectable`)
  }
  // Each publish is scoped to its group, so selecting one never publishes another.
  assert.match(workflow, /release publish --groups=node --nxBail/)
  assert.match(workflow, /release publish --groups=python --nxBail/)
  assert.match(workflow, /release version "\$specifier" \\\n\s+--groups="\$GROUPS"/)
})

// The version step already runs on the expanded $GROUPS list, so a publish step
// that gated on the raw dispatch input would version a binding and never publish
// it: contains('all', 'node') is false. Every publish decision reads the padded
// group list instead.
test('a selected group is published whether named directly or expanded from all', () => {
  const workflow = readSource('.github', 'workflows', 'release-binding.yml')

  assert.match(workflow, /echo "GROUP_LIST=,\$groups," >> "\$GITHUB_ENV"/)

  const gatedBy = [
    ['Publish Node', ',node,'],
    ['Publish Python', ',python,'],
    ['Push the Node and Python tags', ',node,'],
    ['Push the Dart tag', ',dart,'],
  ]
  for (const [step, group] of gatedBy) {
    const condition = workflow.match(new RegExp(`- name: ${step}\\n\\s+if: ([^\\n]+)`))
    assert.ok(condition, `${step} must gate on a condition`)
    assert.match(
      condition[1],
      new RegExp(`contains\\(env\\.GROUP_LIST, '${group}'\\)`),
      `${step} must be gated on the expanded groups, not the raw input`,
    )
  }

  // Nothing may reintroduce substring matching against the input: it silently
  // skips a group named `all` and would match a group named inside another.
  assert.doesNotMatch(workflow, /contains\(inputs\.binding/)

  // A version commit only exists when the version step created one.
  assert.match(workflow, /- name: Push the version commit\n\s+if: \$\{\{ !inputs\.skip_versioning \}\}/)
})

// pub.dev only grants an OIDC publishing token to a matching tag run. The Dart
// job therefore shares the release workflow file while remaining isolated from
// its workflow_dispatch job.
test('the Dart publish runs from a Dart tag in the unified workflow', () => {
  const workflow = readSource('.github', 'workflows', 'release-binding.yml')

  assert.match(workflow, /tags:\n\s+- 'v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /if: github\.event_name == 'push'/)
  assert.match(workflow, /DART_RELEASE_TAG="\$GITHUB_REF_NAME"/)
  assert.match(workflow, /DART_VERSION="\$\{DART_RELEASE_TAG#v\}"/)
  assert.match(workflow, /release publish --groups=dart --nxBail/)
  assert.doesNotMatch(workflow, /PUB_CREDENTIALS|pub-credentials\.json|api_token/)
  assert.equal(existsSync(join('.github', 'workflows', 'publish-dart.yml')), false)
})

test('the publishing workflows carry no pub.dev credentials secret', () => {
  for (const workflow of ['release-binding.yml', 'ci.yml']) {
    const source = readSource('.github', 'workflows', workflow)
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

// The workflow assertions above use multi-line patterns. A Windows runner
// checks out CRLF, so a helper that does not normalise would make main red only
// in CI. This keeps that regression local and obvious.
test('workflow assertions are checked against a CRLF checkout', () => {
  const unix = readSource('.github', 'workflows', 'release-binding.yml')
  const windows = unix.replaceAll('\n', '\r\n')
  assert.notEqual(unix, windows)

  // A multi-line pattern is what breaks under CRLF, so the readSource helper
  // must be what the assertions go through.
  const multiLine = /tags:\n\s+- 'v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'/
  assert.match(unix, multiLine)
  assert.doesNotMatch(windows, multiLine, 'reading raw CRLF text would break this assertion')

  // A single-line pattern is unaffected, which is why normalisation is the fix
  // rather than loosening every pattern.
  assert.match(windows, /id-token: write/)
  assert.match(readSource('.github', 'workflows', 'release-binding.yml'), /id-token: write/)
})

test('each binding versions independently with its own flat release tag', () => {
  assert.deepEqual(Object.keys(workspace.release.groups).sort(), releases.map(([name]) => name).sort())
  for (const [name, project, pattern] of releases) {
    assert.deepEqual(workspace.release.groups[name].projects, [project])
    assert.equal(workspace.release.groups[name].projectsRelationship, 'independent')
    assert.equal(workspace.release.groups[name].releaseTag.pattern, pattern)
  }
})
