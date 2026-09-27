const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const system = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : process.platform
const architecture = process.arch === 'x64' ? 'amd64' : process.arch
const libc = process.platform === 'linux' ? (process.report.getReport().header.glibcVersionRuntime ? '-glibc' : '-musl') : ''
const target = `${system}-${architecture}${libc}`
const library = process.platform === 'win32' ? 'mace_processor.dll' : process.platform === 'darwin' ? 'libmace_processor.dylib' : 'libmace_processor.so'
const asset = join('packages', 'python', 'src', 'mace_python', 'bin', target, library)

test('wheel with a native library is tagged for its platform, not universal', (context) => {
  if (!existsSync(asset)) {
    context.skip('Stage a native processor library before testing package builds.')
    return
  }
  const platform = process.platform === 'win32' ? `win_${process.arch === 'x64' ? 'amd64' : 'arm64'}` : process.env.MACE_WHEEL_PLATFORM
  if (!platform) {
    context.skip('Set the verified MACE_WHEEL_PLATFORM tag for a non-Windows build.')
    return
  }
  execFileSync('uv', ['build', '--wheel', '--directory', 'packages/python'], {
    env: { ...process.env, MACE_WHEEL_PLATFORM: platform },
    stdio: 'inherit',
  })
  assert.ok(readdirSync(join('packages', 'python', 'dist')).some((name) => name.endsWith(`-py3-none-${platform}.whl`)))
})
