import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compareVersions,
  isUpgrade,
  parseReleaseTag,
  buildReleaseDownloadUrl,
  formatMonorepoReleases,
  resolveRepoCatalog,
  checkPluginUpdates,
  readInstalledVersion,
  readInstalledList,
  mergeInstalledVersions,
  LOCAL_MONOREPO_PLUGINS,
} from '../lib/core.js'
import {
  handleMarketRpc,
  resolveOptions,
  fetchGitHubReleases,
  fetchCommunityCatalog,
} from '../lib/index.js'
import { readFileSync } from 'node:fs'

describe('dsh-market core & version comparison', () => {
  it('correctly compares semantic versions', () => {
    assert.equal(compareVersions('0.4.8', '0.4.7'), 1)
    assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
    assert.equal(compareVersions('0.1.0', '0.2.0'), -1)
    assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
    assert.equal(compareVersions('1.10.0', '1.2.0'), 1)
    assert.equal(compareVersions('0.1.26', '0.1.9'), 1)
  })

  it('determines if target is an upgrade', () => {
    assert.equal(isUpgrade('0.4.7', '0.4.8'), true)
    assert.equal(isUpgrade('0.4.8', '0.4.7'), false)
    assert.equal(isUpgrade('0.1.0', '0.1.0'), false)
  })

  it('parses monorepo tag formats', () => {
    const t1 = parseReleaseTag('dsh-model-roles@v0.4.7')
    assert.deepEqual(t1, { name: 'dsh-model-roles', version: '0.4.7', tag: 'dsh-model-roles@v0.4.7' })

    const t2 = parseReleaseTag('dsh-file-viewer@0.1.8')
    assert.deepEqual(t2, { name: 'dsh-file-viewer', version: '0.1.8', tag: 'dsh-file-viewer@0.1.8' })

    const t3 = parseReleaseTag('v1.0.0')
    assert.deepEqual(t3, { name: null, version: '1.0.0', tag: 'v1.0.0' })
  })

  it('builds standard release download urls', () => {
    const url = buildReleaseDownloadUrl('veildawn/dsh-plugins', 'dsh-model-roles', '0.4.7')
    assert.equal(
      url,
      'https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.7/dsh-model-roles-0.4.7.tgz'
    )
  })
})

describe('dsh-market releases formatting and updates detection', () => {
  const FAKE_RELEASES = [
    {
      tag_name: 'dsh-model-roles@v0.4.8',
      published_at: '2026-08-26T22:32:00Z',
      body: 'Bug fixes and performance improvement',
      assets: [
        {
          name: 'dsh-model-roles-0.4.8.tgz',
          browser_download_url: 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz',
        },
      ],
    },
    {
      tag_name: 'dsh-model-roles@v0.4.7',
      published_at: '2026-08-21T17:03:00Z',
    },
    {
      tag_name: 'v9.9.9', // plain tag: not a monorepo plugin release, must be skipped
    },
  ]

  it('formats monorepo GitHub releases and ignores plain tags', () => {
    const releaseMap = formatMonorepoReleases(FAKE_RELEASES)
    assert.equal(releaseMap.has('dsh-model-roles'), true)
    assert.equal(releaseMap.get('dsh-model-roles').version, '0.4.8')
    assert.equal(releaseMap.get('dsh-model-roles').downloadUrl.includes('0.4.8'), true)
    assert.equal(releaseMap.size, 1)
  })

  it('tolerates non-array / garbage release payloads', () => {
    assert.equal(formatMonorepoReleases(null).size, 0)
    assert.equal(formatMonorepoReleases({ message: 'rate limited' }).size, 0)
  })

  it('resolves catalog with merged release information', () => {
    const releaseMap = new Map([
      [
        'dsh-model-roles',
        {
          name: 'dsh-model-roles',
          version: '0.4.8',
          tag: 'dsh-model-roles@v0.4.8',
          downloadUrl: 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz',
          releaseNotes: 'Updated',
          publishedAt: '2026-08-26',
        },
      ],
    ])

    const catalog = resolveRepoCatalog(releaseMap)
    const modelRoles = catalog.find((p) => p.name === 'dsh-model-roles')
    assert.ok(modelRoles)
    assert.equal(modelRoles.version, '0.4.8')
  })

  it('detects available updates for installed plugins', () => {
    const installed = [
      { name: 'dsh-model-roles', version: '0.4.7' },
      { name: 'dsh-terminal', version: '0.1.9' },
    ]
    const catalog = [
      { name: 'dsh-model-roles', version: '0.4.8', downloadUrl: 'http://test/0.4.8.tgz' },
      { name: 'dsh-terminal', version: '0.1.9', downloadUrl: 'http://test/0.1.9.tgz' },
    ]

    const checked = checkPluginUpdates(installed, catalog)
    assert.equal(checked[0].hasUpdate, true)
    assert.equal(checked[0].latestVersion, '0.4.8')
    assert.equal(checked[1].hasUpdate, false)
  })
})

describe('dsh-market profile installed-version inspection', () => {
  let home
  before(() => {
    home = mkdtempSync(join(tmpdir(), 'dsh-market-test-'))
    for (const [name, version] of [['dsh-model-roles', '0.4.7'], ['dsh-terminal', '0.1.9'], ['dsh-market', '0.1.0']]) {
      const dir = join(home, 'profiles', 'web', 'node_modules', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
    }
  })
  after(() => { rmSync(home, { recursive: true, force: true }) })

  it('reads installed versions from profile node_modules', () => {
    assert.equal(readInstalledVersion('dsh-model-roles', { home, profile: 'web' }), '0.4.7')
    assert.equal(readInstalledVersion('dsh-terminal', { home, profile: 'web' }), '0.1.9')
  })

  it('returns null for missing or unreadable plugins', () => {
    assert.equal(readInstalledVersion('does-not-exist', { home, profile: 'web' }), null)
  })

  it('lists only installed plugins', () => {
    const names = LOCAL_MONOREPO_PLUGINS.map((p) => p.name)
    const installed = readInstalledList(names, { home, profile: 'web' })
    assert.deepEqual(installed.map((e) => e.name).sort(), ['dsh-market', 'dsh-model-roles', 'dsh-terminal'])
  })

  it('merges installed versions and flags updates', () => {
    const catalog = resolveRepoCatalog(new Map())
    const modelRoles = catalog.find((p) => p.name === 'dsh-model-roles')
    modelRoles.version = '0.4.8'
    const merged = mergeInstalledVersions(catalog, { home, profile: 'web' })
    const entry = merged.plugins.find((p) => p.name === 'dsh-model-roles')
    assert.equal(entry.installedVersion, '0.4.7')
    assert.equal(entry.hasUpdate, true)
    assert.equal(merged.profile, 'web')
    const fresh = merged.plugins.find((p) => p.name === 'dsh-market')
    assert.equal(fresh.hasUpdate, false)
  })
})

describe('dsh-market RPC handler (network stubbed)', () => {
  const FAKE_RELEASES = [
    {
      tag_name: 'dsh-model-roles@v0.4.8',
      published_at: '2026-08-26T22:32:00Z',
      body: 'Bug fixes',
      assets: [{ name: 'dsh-model-roles-0.4.8.tgz', browser_download_url: 'https://github.com/x/y/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz' }],
    },
  ]
  const FAKE_COMMUNITY = [
    { name: 'dsh-community-demo', title: 'Demo', description: 'A demo plugin', homepage: 'https://github.com/example/demo' },
    { name: 'another-plugin', title: 'Another', description: 'Another plugin' },
  ]
  let originalFetch

  before(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (String(url).includes('api.github.com')) {
        return { ok: true, json: async () => FAKE_RELEASES }
      }
      if (String(url).includes('plugins.json')) {
        return { ok: true, json: async () => ({ plugins: FAKE_COMMUNITY }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }
  })
  after(() => { globalThis.fetch = originalFetch })

  it('fetches and caches GitHub releases through the stub', async () => {
    const releases = await fetchGitHubReleases('veildawn/dsh-plugins')
    assert.equal(Array.isArray(releases), true)
    assert.equal(releases[0].tag_name, 'dsh-model-roles@v0.4.8')
  })

  it('fetches community catalog through the stub', async () => {
    const plugins = await fetchCommunityCatalog('https://mirror.example/plugins.json')
    assert.equal(plugins.length, 2)
  })

  it('handles getRepoPlugins RPC without hitting the network', async () => {
    const res = await handleMarketRpc({}, { repoOrigin: 'veildawn/dsh-plugins' }, 'getRepoPlugins', {})
    assert.equal(res.ok, true)
    assert.ok(Array.isArray(res.value.plugins))
    assert.ok(res.value.plugins.length >= 7)
    assert.equal(typeof res.value.profile, 'string')
    assert.equal(typeof res.value.checkedAt, 'string')
  })

  it('handles getCommunityPlugins RPC', async () => {
    const res = await handleMarketRpc({}, {}, 'getCommunityPlugins', {})
    assert.equal(res.ok, true)
    assert.equal(res.value.count, 2)
  })

  it('handles checkUpdates RPC', async () => {
    const res = await handleMarketRpc({}, {}, 'checkUpdates', {})
    assert.equal(res.ok, true)
    assert.ok(Array.isArray(res.value.results))
  })

  it('handles getConfig and updateConfig RPC', async () => {
    const configRes = await handleMarketRpc({}, {}, 'getConfig', {})
    assert.equal(configRes.ok, true)
    assert.equal(configRes.value.repoOrigin, 'veildawn/dsh-plugins')

    let mutated = null
    const ctx = { settings: { mutate: async (ns, ops) => { mutated = { ns, ops } } } }
    const updateRes = await handleMarketRpc(ctx, {}, 'updateConfig', { repoOrigin: 'my-org/dsh-plugins' })
    assert.equal(updateRes.ok, true)
    assert.equal(updateRes.value.repoOrigin, 'my-org/dsh-plugins')
    assert.deepEqual(mutated.ops, [{ op: 'set', path: ['repoOrigin'], value: 'my-org/dsh-plugins' }])
  })

  it('rejects invalid config values and unknown keys', async () => {
    const bad = await handleMarketRpc({}, {}, 'updateConfig', { repoOrigin: 42 })
    assert.equal(bad.ok, false)
    const unknown = await handleMarketRpc({}, {}, 'updateConfig', { notAKey: 1 })
    assert.equal(unknown.ok, false)
    const missing = await handleMarketRpc({}, {}, 'noSuchMethod', {})
    assert.equal(missing.ok, false)
  })

  it('resolveOptions sanitizes malformed configuration', () => {
    const resolved = resolveOptions({ repoOrigin: '', autoCheckUpdates: 'yes' })
    assert.equal(resolved.repoOrigin, 'veildawn/dsh-plugins')
    assert.equal(resolved.autoCheckUpdates, true)
  })
})

describe('dsh-market client bundle verification', () => {
  it('client bundle is valid and registers ModuleLoader', () => {
    const clientCode = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    assert.equal(clientCode.includes('window.__ModuleLoader__.load'), true)
    assert.equal(clientCode.includes('id: "dsh-market"'), true)
    // RPC must go through ctx.connection.rpc (the loopback RPC surface),
    // not the raw connection object.
    assert.equal(clientCode.includes('const rpc = ctx.connection.rpc'), true)
    assert.equal(clientCode.includes('rpc.call(MARKET_RPC_CHANNEL'), true)
  })

  it('cordis patch entry id matches the host-side service name', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const index = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    assert.equal(patch.includes('id: market'), true)
    assert.equal(index.includes("export const name = 'market'"), true)
  })
})
