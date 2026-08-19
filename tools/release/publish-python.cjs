const { execFileSync } = require('node:child_process')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const distributionDirectory = join('packages', 'python', 'dist')

if (process.env.NX_DRY_RUN === 'true') {
  console.log('NX_DRY_RUN is true; skipping PyPI publication.')
  process.exit(0)
}

const pyproject = readFileSync(join('packages', 'python', 'pyproject.toml'), 'utf-8')
const version = pyproject.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]

if (!version) {
  throw new Error('Unable to determine the Python package version from pyproject.toml.')
}

const distributions = readdirSync(distributionDirectory)
  .filter((file) => file.endsWith('.tar.gz') || file.endsWith('.whl'))
  .filter((file) => file.includes(`-${version}`))
  .map((file) => join(distributionDirectory, file))

if (distributions.length === 0) {
  throw new Error(`No Python distributions for version ${version} found in ${distributionDirectory}. Run the build target first.`)
}

execFileSync('uv', ['publish', ...distributions], { stdio: 'inherit' })
