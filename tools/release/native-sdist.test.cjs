const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const targets = [
  'darwin-amd64', 'darwin-arm64',
  'windows-amd64',
  'linux-amd64-glibc', 'linux-arm64-glibc',
]

const nativeName = (target) => target.startsWith('windows') ? 'mace_processor.dll'
  : target.startsWith('darwin') ? 'libmace_processor.dylib' : 'libmace_processor.so'

test('sdist contains all supported native variants and builds a single-platform wheel offline', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'mace-native-sdist-'))
  try {
    const packageRoot = join('packages', 'python')
    for (const filename of ['pyproject.toml', 'hatch_build.py', 'README.md']) {
      copyFileSync(join(packageRoot, filename), join(fixture, filename))
    }
    const source = join(fixture, 'src', 'mace_python')
    mkdirSync(source, { recursive: true })
    for (const filename of ['__init__.py', '_client.py']) {
      copyFileSync(join(packageRoot, 'src', 'mace_python', filename), join(source, filename))
    }
    for (const target of targets) {
      const directory = join(source, 'bin', target)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, nativeName(target)), `fixture:${target}`)
    }

    execFileSync('uv', ['build', '--sdist', '--directory', fixture], { stdio: 'pipe' })
    const archive = join(fixture, 'dist', readdirSync(join(fixture, 'dist')).find((name) => name.endsWith('.tar.gz')))
    assert.ok(existsSync(archive))
    const unpack = join(fixture, 'unpack')
    mkdirSync(unpack)
    execFileSync('tar', ['-xf', archive, '-C', unpack])
    const extracted = join(unpack, readdirSync(unpack)[0])
    for (const target of targets) {
      assert.ok(existsSync(join(extracted, 'src', 'mace_python', 'bin', target, nativeName(target))))
    }
    assert.ok(existsSync(join(extracted, 'hatch_build.py')))

    const environment = { ...process.env, MACE_NATIVE_TARGET: 'windows-amd64', MACE_WHEEL_PLATFORM: 'win_amd64' }
    // An offline wheel build only needs an already installed PEP 517 backend.
    execFileSync('uv', ['venv', '--directory', extracted, '.venv'], { stdio: 'pipe' })
    const python = process.platform === 'win32' ? join(extracted, '.venv', 'Scripts', 'python.exe') : join(extracted, '.venv', 'bin', 'python')
    execFileSync('uv', ['pip', 'install', '--python', python, 'hatchling>=1.27,<2'], { stdio: 'pipe' })
    execFileSync('uv', ['build', '--wheel', '--offline', '--no-build-isolation', '--directory', extracted], { env: { ...environment, VIRTUAL_ENV: join(extracted, '.venv') }, stdio: 'pipe' })
    const wheel = join(extracted, 'dist', readdirSync(join(extracted, 'dist')).find((name) => name.endsWith('-win_amd64.whl')))
    const members = JSON.parse(execFileSync(python, ['-c', 'import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', wheel]).toString())
    assert.equal(members.filter((member) => member.endsWith('.dll') || member.endsWith('.so') || member.endsWith('.dylib')).length, 1)
    assert.ok(members.includes('mace_python/bin/windows-amd64/mace_processor.dll'))
    assert.throws(() => execFileSync('uv', ['build', '--wheel', '--offline', '--no-build-isolation', '--directory', extracted], {
      env: { ...environment, MACE_WHEEL_PLATFORM: 'manylinux_2_17_x86_64', VIRTUAL_ENV: join(extracted, '.venv') },
      stdio: 'pipe',
    }))

    rmSync(join(source, 'bin', 'linux-arm64-glibc', nativeName('linux-arm64-glibc')))
    assert.throws(() => execFileSync('uv', ['build', '--sdist', '--directory', fixture], { stdio: 'pipe' }))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
