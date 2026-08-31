const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const packageDirectory = join('packages', 'dart')

if (process.env.NX_DRY_RUN === 'true') {
  console.log('NX_DRY_RUN is true; skipping pub.dev publication.')
  process.exit(0)
}

const pubspec = readFileSync(join(packageDirectory, 'pubspec.yaml'), 'utf-8')
const version = pubspec.match(/^version\s*:\s*(\S+)\s*$/m)?.[1]

if (!version) {
  throw new Error('Unable to determine the Dart package version from pubspec.yaml.')
}

execFileSync('dart', ['pub', 'publish', '--force'], {
  cwd: packageDirectory,
  stdio: 'inherit',
})
