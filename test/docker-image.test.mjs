import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { publishedPort, upstreamPort } from '../docker-ports.mjs'
import { pluginAddArgs, pluginsToInstall, readInstalledVersion, readTarballManifest } from '../docker-sync-plugins.mjs'

test('the published port and the DSH upstream port stay distinct', () => {
  assert.equal(publishedPort({}), 3080)
  assert.equal(upstreamPort({}), 3081)
  assert.equal(upstreamPort({ DSH_PORT: '3080' }), 3081)
  assert.equal(upstreamPort({ DSH_PORT: '3081' }), 3082)
  assert.equal(upstreamPort({ DSH_PORT: '8080', DSH_UPSTREAM_PORT: '9080' }), 9080)
  assert.throws(() => upstreamPort({ DSH_PORT: '3081', DSH_UPSTREAM_PORT: '3081' }), /must differ/)
  assert.throws(() => publishedPort({ DSH_PORT: '0' }), /DSH_PORT/)
  assert.throws(() => publishedPort({ DSH_PORT: 'nope' }), /DSH_PORT/)
})

test('plugin updates pin the image pnpm store', () => {
  assert.deepEqual(
    pluginAddArgs('/opt/dsh-plugins/dsh-remote-control.tgz'),
    ['plugin', '--profile', 'web', 'add', '--store-dir', '/home/node/.local/share/pnpm/store', '/opt/dsh-plugins/dsh-remote-control.tgz'],
  )
})

test('startup installs a bundled plugin only when the mounted profile differs', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-docker-'))
  try {
    const tarball = writePluginTarball(root, '@weniatall/dsh-remote-control', '0.1.42')
    const profile = join(root, 'profile')
    assert.deepEqual(pluginsToInstall(profile, [tarball]), [tarball])

    const installed = join(profile, 'node_modules', '@weniatall', 'dsh-remote-control')
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'package.json'), JSON.stringify({
      name: '@weniatall/dsh-remote-control',
      version: '0.1.41',
    }))
    assert.equal(readInstalledVersion(profile, '@weniatall/dsh-remote-control'), '0.1.41')
    assert.deepEqual(pluginsToInstall(profile, [tarball]), [tarball])

    writeFileSync(join(installed, 'package.json'), JSON.stringify({
      name: '@weniatall/dsh-remote-control',
      version: '0.1.42',
    }))
    assert.deepEqual(pluginsToInstall(profile, [tarball]), [])
    assert.equal(readTarballManifest(tarball).version, '0.1.42')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function writePluginTarball(root, name, version) {
  const stage = join(root, `stage-${version}`)
  mkdirSync(join(stage, 'package'), { recursive: true })
  writeFileSync(join(stage, 'package', 'package.json'), JSON.stringify({ name, version }))
  const tarball = join(root, `${version}.tgz`)
  execFileSync('tar', ['-czf', tarball, '-C', stage, 'package'])
  return tarball
}
