// Publishes the Node package. Honours NX_DRY_RUN so the release workflow can
// prove every publish command succeeds before any registry is touched.
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const packageDirectory = join('packages', 'node')
const { version } = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))

if (!version) {
  throw new Error('Unable to determine the Node package version from package.json.')
}

if (process.env.NX_DRY_RUN === 'true') {
  console.log(`NX_DRY_RUN is true; would publish @code-fixer-23/mace-node ${version}.`)
  process.exit(0)
}

let alreadyPublished = false
try {
  execFileSync('npm', ['view', `@code-fixer-23/mace-node@${version}`, 'version'], { stdio: 'pipe' })
  alreadyPublished = true
} catch {
  // A version that cannot be found is exactly what we want before publishing.
}

if (alreadyPublished) {
  throw new Error(`@code-fixer-23/mace-node ${version} is already on the registry.`)
}

execFileSync('npm', ['publish', '--access', 'public', '--no-git-checks'], {
  cwd: packageDirectory,
  stdio: 'inherit',
})
