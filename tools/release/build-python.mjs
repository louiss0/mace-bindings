#!/usr/bin/env node
// Builds the Python sdist and one wheel per published target.
//
// A wheel only bundles a staged library and carries a platform tag, so every
// wheel can be produced on one host. The build hook validates the tag against
// packages/python/native_targets.json, which is also what this script reads, so
// a wheel can never be tagged for a platform the hook would reject.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const packageRoot = join('packages', 'python')
const distributionDirectory = join(packageRoot, 'dist')
const nativeTargets = JSON.parse(readFileSync(join(packageRoot, 'native_targets.json'), 'utf8'))

const build = (arguments_, environment) =>
  execFileSync('uv', ['build', '--directory', packageRoot, ...arguments_], {
    stdio: 'pipe',
    env: { ...process.env, ...environment },
  })

build(['--sdist'], {})
console.log('Built the sdist')

for (const [target, entry] of Object.entries(nativeTargets)) {
  build(['--wheel'], { MACE_NATIVE_TARGET: target, MACE_WHEEL_PLATFORM: entry.wheelTag })
  console.log(`Built the ${target} wheel`)
}

const distributions = readdirSync(distributionDirectory)
const sdist = distributions.filter((name) => name.endsWith('.tar.gz'))
const wheels = distributions.filter((name) => name.endsWith('.whl'))

if (sdist.length !== 1) throw new Error(`expected one sdist, found ${sdist.length}`)
if (wheels.length !== Object.keys(nativeTargets).length) {
  throw new Error(`expected ${Object.keys(nativeTargets).length} wheels, found ${wheels.length}`)
}
for (const wheel of wheels) {
  if (wheel.includes('none-any')) throw new Error(`${wheel} is not platform tagged`)
}

console.log(`\n${sdist.length} sdist and ${wheels.length} wheels ready for publication`)
for (const name of [sdist[0], ...wheels.sort()]) console.log(`  ${name}`)
