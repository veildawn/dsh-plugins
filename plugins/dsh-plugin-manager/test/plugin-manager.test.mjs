import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
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
  normalizeCommunityPlugins,
  communityCategories,
  safeProfileName,
  safePackageName,
  isAllowedRepoUrl,
  LOCAL_MONOREPO_PLUGINS,
  stripPluginFromLockfile,
  lockfileHealthForPlugin,
  profileLockfilePath,
  readProfileLockfile,
  listLockfilePluginEntries,
  normalizeTarballUrl,
  readHostDshVersion,
  parseDshReleaseTag,
  checkDshUpdate,
} from '../lib/core.js'
import {
  handleMarketRpc,
  handleInstallPlugin,
  handleBatchUpdatePlugins,
  handleRemovePlugin,
  handleRestartHost,
  resolveOptions,
  fetchGitHubReleases,
  fetchCommunityCatalog,
  runDshPluginCommand,
  resetMarketCaches,
  _setHttpFetch,
  _resetHttpFetch,
  queryDshUpdate,
  fetchDshGitHubReleases,
  fetchDshNpmMeta,
} from '../lib/index.js'

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

    // Verifies monorepo known plugins have friendly Chinese title and descriptions
    const archiveMgr = catalog.find((p) => p.name === 'dsh-archive-manager')
    assert.ok(archiveMgr)
    assert.equal(archiveMgr.title, '会话归档管理器')
    assert.ok(archiveMgr.description.includes('会话归档管理'))

    const promptHist = catalog.find((p) => p.name === 'dsh-prompt-history')
    assert.ok(promptHist)
    assert.equal(promptHist.title, '提示词历史与修改重发')
    assert.ok(promptHist.description.includes('提示词历史导航'))
  })

  it('dynamically discovers newly added repo plugins not in hardcoded base list', () => {
    const releaseMap = new Map([
      [
        'dsh-brand-new-plugin',
        {
          name: 'dsh-brand-new-plugin',
          version: '1.0.0',
          tag: 'dsh-brand-new-plugin@v1.0.0',
          downloadUrl: 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-brand-new-plugin@v1.0.0/dsh-brand-new-plugin-1.0.0.tgz',
          releaseNotes: 'Brand new official plugin released',
          publishedAt: '2026-08-27',
        },
      ],
    ])

    const catalog = resolveRepoCatalog(releaseMap)
    const newPlugin = catalog.find((p) => p.name === 'dsh-brand-new-plugin')
    assert.ok(newPlugin, 'Newly released plugin must be present in repo catalog')
    assert.equal(newPlugin.version, '1.0.0')
    assert.equal(newPlugin.isRepoPlugin, true)
    assert.equal(newPlugin.downloadUrl.includes('dsh-brand-new-plugin'), true)
  })

  it('excludes renamed/superseded plugin names (dsh-market) from dynamic discovery', () => {
    const releaseMap = new Map([
      [
        'dsh-market', // historical name of dsh-plugin-manager — must NOT appear
        {
          name: 'dsh-market',
          version: '0.1.7',
          tag: 'dsh-market@v0.1.7',
          downloadUrl: 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-market@v0.1.7/dsh-market-0.1.7.tgz',
        },
      ],
    ])

    const catalog = resolveRepoCatalog(releaseMap)
    assert.equal(catalog.some((p) => p.name === 'dsh-market'), false, 'dsh-market must be excluded as a renamed name')
    // dsh-plugin-manager itself (the canonical name) must still be present
    assert.equal(catalog.some((p) => p.name === 'dsh-plugin-manager'), true)
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
    // Write profile manifest with repo source dependencies
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: {
        'dsh-model-roles': 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.7/dsh-model-roles-0.4.7.tgz',
        'dsh-terminal': 'github:veildawn/dsh-plugins#path:/plugins/dsh-terminal',
        'dsh-plugin-manager': 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-plugin-manager@v0.1.0/dsh-plugin-manager-0.1.0.tgz',
        'dsh-status-rotator': '^1.0.0', // npm community plugin
      },
    }))

    for (const [name, version] of [['dsh-model-roles', '0.4.7'], ['dsh-terminal', '0.1.9'], ['dsh-plugin-manager', '0.1.0'], ['dsh-status-rotator', '1.0.0']]) {
      const dir = join(profileDir, 'node_modules', name)
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
    assert.deepEqual(installed.map((e) => e.name).sort(), ['dsh-model-roles', 'dsh-plugin-manager', 'dsh-terminal'])
  })

  it('merges installed versions and flags updates for repo plugins', () => {
    const catalog = resolveRepoCatalog(new Map())
    const modelRoles = catalog.find((p) => p.name === 'dsh-model-roles')
    modelRoles.version = '0.4.8'
    const merged = mergeInstalledVersions(catalog, { home, profile: 'web' })
    const entry = merged.plugins.find((p) => p.name === 'dsh-model-roles')
    assert.equal(entry.installedVersion, '0.4.7')
    assert.equal(entry.hasUpdate, true)
    assert.equal(merged.profile, 'web')
    const fresh = merged.plugins.find((p) => p.name === 'dsh-plugin-manager')
    assert.equal(fresh.installedVersion, '0.1.0')
    assert.equal(fresh.hasUpdate, false)
  })

  it('enriches community catalog with local installed versions while isolating repo plugins', () => {
    const raw = {
      plugins: [
        { name: 'dsh-status-rotator', npm: 'dsh-status-rotator', version: '1.2.0', category: 'ui' },
        // Same-named community entry as a local monorepo plugin:
        { name: 'dsh-terminal', npm: 'dsh-terminal', owner: 'other-author', version: '2.0.0', category: 'tools' },
        { name: 'uninstalled-plugin', npm: 'uninstalled-plugin', version: '0.5.0', category: 'tools' },
      ],
    }
    const list = normalizeCommunityPlugins(raw, 'zh', { home, profile: 'web' })
    assert.equal(list.length, 3)
    // Pure npm community plugin is correctly recognized as installed
    assert.equal(list[0].installedVersion, '1.0.0')
    assert.equal(list[0].hasUpdate, true)
    // Same-named repo plugin is strictly ISOLATED from the community catalog:
    assert.equal(list[1].installedVersion, null)
    assert.equal(list[1].hasUpdate, false)
    // Uninstalled plugin remains uninstalled
    assert.equal(list[2].installedVersion, null)
    assert.equal(list[2].hasUpdate, false)
  })
})


describe('dsh-market lockfile utilities', () => {
  const LOCKFILE = [
    "lockfileVersion: '9.0'",
    '',
    'settings:',
    '  autoInstallPeers: false',
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      dsh-model-roles:',
    '        specifier: https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz',
    '        version: https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz(@deepseek-ai/schemastery@3.18.1)',
    '      dsh-file-viewer:',
    '        specifier: https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer%40v0.1.10/dsh-file-viewer-0.1.10.tgz',
    '        version: https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer%40v0.1.10/dsh-file-viewer-0.1.10.tgz(@deepseek-ai/schemastery@3.18.1)',
    '',
    'packages:',
    '',
    "  '@deepseek-ai/dsh-llm@0.1.1-rc.2':",
    '    resolution: {integrity: sha512-AAA}',
    '',
    '  dsh-model-roles@https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz:',
    '    resolution: {integrity: sha512-BBB, tarball: https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz}',
    '    version: 0.4.8',
    '',
    '  dsh-file-viewer@https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer%40v0.1.10/dsh-file-viewer-0.1.10.tgz:',
    '    resolution: {integrity: sha512-CCC, tarball: https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer%40v0.1.10/dsh-file-viewer-0.1.10.tgz}',
    '    version: 0.1.10',
    '    peerDependencies:',
    "      '@deepseek-ai/schemastery': ^3.18.1",
    '',
    'snapshots:',
    '',
    "  '@deepseek-ai/dsh-llm@0.1.1-rc.2':",
    '    dependencies: {}',
    '',
    '  dsh-file-viewer@https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer%40v0.1.10/dsh-file-viewer-0.1.10.tgz(@deepseek-ai/schemastery@3.18.1):',
    '    dependencies:',
    "      '@deepseek-ai/schemastery': 3.18.1",
    '',
  ].join('\n') + '\n'

  let home
  before(() => {
    home = mkdtempSync(join(tmpdir(), 'dsh-lock-test-'))
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), LOCKFILE, 'utf8')
  })
  after(() => { rmSync(home, { recursive: true, force: true }) })

  it('lists lockfile packages entries for a plugin', () => {
    const entries = listLockfilePluginEntries('dsh-file-viewer', { home, profile: 'web' })
    assert.equal(entries.length, 2) // packages + snapshots
    assert.ok(entries[0].url.includes('v0.1.10'))
  })

  it('normalizes tarball URL encoding variance', () => {
    assert.equal(
      normalizeTarballUrl('https://github.com/x/y%40v0.1.0/a-0.1.0.tgz'),
      'https://github.com/x/y@v0.1.0/a-0.1.0.tgz'
    )
    assert.equal(normalizeTarballUrl(''), '')
  })

  it('flags stale (non-target) lockfile entries as unhealthy', () => {
    // Target is v0.1.11 but lockfile has v0.1.10 -> stale
    const health = lockfileHealthForPlugin(
      'dsh-file-viewer',
      'https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer%40v0.1.11/dsh-file-viewer-0.1.11.tgz',
      { home, profile: 'web' }
    )
    assert.equal(health.healthy, false)
    assert.equal(health.staleCount, 2)
  })

  it('treats matching target as healthy', () => {
    const health = lockfileHealthForPlugin(
      'dsh-file-viewer',
      'https://github.com/veildawn/dsh-plugins/releases/download/dsh-file-viewer%40v0.1.10/dsh-file-viewer-0.1.10.tgz',
      { home, profile: 'web' }
    )
    assert.equal(health.healthy, true)
    assert.equal(health.staleCount, 0)
  })

  it('strips a plugin completely from the lockfile', () => {
    const res = stripPluginFromLockfile('dsh-file-viewer', { home, profile: 'web' })
    assert.equal(res.removed, 3) // importer + packages + snapshots
    assert.equal(res.rewritten, true)

    const after = readProfileLockfile({ home, profile: 'web' })
    assert.equal(after.includes('dsh-file-viewer'), false)
    // Other plugins and sections remain intact
    assert.equal(after.includes('dsh-model-roles'), true)
    assert.equal(after.includes('packages:'), true)
    assert.equal(after.includes('snapshots:'), true)
    assert.equal(after.includes('importers:'), true)
  })

  it('is a no-op when nothing to strip', () => {
    const res = stripPluginFromLockfile('dsh-never-existed', { home, profile: 'web' })
    assert.equal(res.removed, 0)
    assert.equal(res.rewritten, false)
  })

  it('returns empty entries for missing lockfile', () => {
    const other = join(home, 'profiles', 'other')
    mkdirSync(other, { recursive: true })
    assert.deepEqual(listLockfilePluginEntries('dsh-file-viewer', { home, profile: 'other' }), [])
    assert.equal(lockfileHealthForPlugin('dsh-file-viewer', 'http://x.tgz', { home, profile: 'other' }).healthy, true)
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
    _setHttpFetch(async (url) => {
      if (String(url).includes('deepseek-harness/releases')) {
        return {
          ok: true,
          json: async () => [
            {
              tag_name: 'dsh-v0.1.5-rc.1',
              published_at: '2026-09-10T03:09:00Z',
              body: 'Major DSH updates',
              html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1',
            },
          ],
        }
      }
      if (String(url).includes('api.github.com')) {
        return { ok: true, json: async () => FAKE_RELEASES }
      }
      if (String(url).includes('plugins.json')) {
        return { ok: true, json: async () => ({ plugins: FAKE_COMMUNITY }) }
      }
      if (String(url).includes('@deepseek-ai%2Fdsh') || String(url).includes('@deepseek-ai/dsh')) {
        return {
          ok: true,
          json: async () => ({
            name: '@deepseek-ai/dsh',
            'dist-tags': { latest: '0.1.5-rc.1', alpha: '0.1.5-alpha.2' },
            time: { '0.1.5-rc.1': '2026-09-10T03:12:53.293Z' },
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  })
  after(() => {
    _resetHttpFetch()
  })

  it('fetches and caches GitHub releases through the stub', async () => {
    const releases = await fetchGitHubReleases('veildawn/dsh-plugins')
    assert.equal(Array.isArray(releases), true)
    assert.equal(releases[0].tag_name, 'dsh-model-roles@v0.4.8')
  })

  it('fetches community catalog through the stub', async () => {
    const data = await fetchCommunityCatalog('https://mirror.example/plugins.json')
    assert.equal(Array.isArray(data.plugins), true)
    assert.equal(data.plugins.length, 2)
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

  it('handles checkDshUpdate RPC and returns update info', async () => {
    const fakeSpawn = () => ({
      status: 0,
      stdout: '0.1.2-rc.1\n',
      stderr: '',
    })
    const res = await handleMarketRpc({}, {}, 'checkDshUpdate', {}, { spawnFn: fakeSpawn })
    assert.equal(res.ok, true)
    assert.equal(res.value.name, '@deepseek-ai/dsh')
    assert.equal(res.value.currentVersion, '0.1.2-rc.1')
    assert.equal(res.value.latestVersion, '0.1.5-rc.1')
    assert.equal(res.value.hasUpdate, true)
    assert.ok(res.value.releaseUrl)
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

  it('respects autoCheckUpdates: false and obeys force: true', async () => {
    let fetchCalled = false
    _setHttpFetch(async (url) => {
      if (String(url).includes('api.github.com')) {
        fetchCalled = true
        return { ok: true, json: async () => FAKE_RELEASES }
      }
      return { ok: true, json: async () => ({}) }
    })

    // With autoCheckUpdates: false and no force -> should not fetch
    fetchCalled = false
    const resOff = await handleMarketRpc({}, { autoCheckUpdates: false }, 'getRepoPlugins', {})
    assert.equal(resOff.ok, true)
    assert.equal(fetchCalled, false, 'Should not fetch releases when autoCheckUpdates is false')

    // With autoCheckUpdates: false but force: true -> should fetch
    fetchCalled = false
    const resForced = await handleMarketRpc({}, { autoCheckUpdates: false }, 'getRepoPlugins', { force: true })
    assert.equal(resForced.ok, true)
    assert.equal(fetchCalled, true, 'Should fetch releases when force is true')
  })
})


describe('dsh-market lockfile RPC (getLockfileHealth / repairLockfile)', () => {
  let home
  const originalDshHome = process.env.DSH_HOME
  const FAKE_RELEASES = [
    {
      tag_name: 'dsh-model-roles@v0.4.8',
      published_at: '2026-08-26T22:32:00Z',
      assets: [{ name: 'dsh-model-roles-0.4.8.tgz', browser_download_url: 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz' }],
    },
  ]

  before(() => {
    home = mkdtempSync(join(tmpdir(), 'dsh-lock-rpc-'))
    process.env.DSH_HOME = home
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), [
      "lockfileVersion: '9.0'",
      '',
      'importers:',
      '',
      '  .:',
      '    dependencies:',
      '      dsh-model-roles:',
      '        specifier: https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.7/dsh-model-roles-0.4.7.tgz',
      '        version: https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.7/dsh-model-roles-0.4.7.tgz(@deepseek-ai/schemastery@3.18.1)',
      '',
      'packages:',
      '',
      '  dsh-model-roles@https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.7/dsh-model-roles-0.4.7.tgz:',
      '    resolution: {integrity: sha512-AAA, tarball: https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.7/dsh-model-roles-0.4.7.tgz}',
      '    version: 0.4.7',
      '',
    ].join('\n') + '\n', 'utf8')
    _setHttpFetch(async (url) => {
      if (String(url).includes('api.github.com')) return { ok: true, json: async () => FAKE_RELEASES }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  })
  after(() => {
    _resetHttpFetch()
    if (originalDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalDshHome
    rmSync(home, { recursive: true, force: true })
  })

  it('getLockfileHealth reports stale entries for a plugin', async () => {
    const res = await handleMarketRpc({}, {}, 'getLockfileHealth', {})
    assert.equal(res.ok, true)
    assert.equal(res.value.exists, true)
    assert.equal(res.value.profile, 'web')
    assert.ok(Array.isArray(res.value.plugins))
    // dsh-model-roles target is v0.4.8 but lockfile records v0.4.7 -> stale
    const mr = res.value.plugins.find((p) => p.name === 'dsh-model-roles')
    assert.ok(mr)
    assert.equal(mr.healthy, false)
    assert.ok(res.value.staleCount >= 1)
  })

  it('repairLockfile strips stale entries', async () => {
    const res = await handleMarketRpc({}, {}, 'repairLockfile', { names: ['dsh-model-roles'] })
    assert.equal(res.ok, true)
    assert.ok(res.value.repaired.length >= 1)
    const after = readProfileLockfile()
    assert.equal(after.includes('dsh-model-roles'), false)
  })

  it('repairLockfile rejects empty names', async () => {
    const res = await handleMarketRpc({}, {}, 'repairLockfile', { names: [] })
    assert.equal(res.ok, false)
  })
})

/**
 * The client bundle registers itself exactly once per process through
 * `window.__ModuleLoader__.load`, and `import()` caches the evaluated module.
 * Every client-side suite below therefore shares this captured definition.
 */
let capturedPluginDefinition = null

describe('dsh-plugin-manager client bundle verification', () => {
  it("renders PluginManagerSection under all tab and update states without crashing", async () => {
    let definition;
    const prevWindow = globalThis.window;
    globalThis.window = { __ModuleLoader__: { load(value) { definition = value; } } };
    try {
      await import("../lib/client.js");
      capturedPluginDefinition = definition;
      const fakeReact = {
        useEffect: () => {},
        useRef: (init) => ({ current: init }),
        useMemo: (fn) => fn(),
        useCallback: (fn) => fn,
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        Fragment: "Fragment",
      };
      const plugin = definition.factory((id) => {
        if (id === "react") return fakeReact;
        if (id === "react-dom") return { createPortal: (node) => node };
        if (id === "@deepseek-ai/dsh-client-ui-primitives") return new Proxy({}, { get: () => () => ({ type: "icon" }) });
        return {};
      });
      const slots = [];
      const ctx = {
        slots: { inject(slot, fn) { fn(); }, register(entry, comp) { slots.push({ entry, comp }); } },
        connection: { rpc: { call: async () => ({}) } },
        remote: { $on: () => () => {} },
      };
      plugin.apply(ctx);
      const Comp = slots[0].comp;
      function testRender(overrides) {
        let idx = 0;
        fakeReact.useState = (init) => {
          const curIdx = idx++;
          if (overrides[curIdx] !== undefined) return [overrides[curIdx], () => {}];
          return [typeof init === "function" ? init() : init, () => {}];
        };
        return Comp({});
      }
      for (const tab of ["repo", "community", "config"]) {
        for (const hasUpdate of [false, true]) {
          testRender({
            0: tab,
            5: hasUpdate ? [{ id: "test", name: "dsh-test", installedVersion: "0.1.0", hasUpdate: true, latestVersion: "0.2.0" }] : [],
          });
        }
      }
    } finally {
      globalThis.window = prevWindow;
    }
  });

  it('client bundle is valid and registers ModuleLoader', () => {
    const clientCode = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    assert.equal(clientCode.includes('window.__ModuleLoader__.load'), true)
    assert.equal(clientCode.includes('id: "dsh-plugin-manager"'), true)
    assert.equal(clientCode.includes('IconPluginManager16'), true)
    // Lazy connection access (must not crash when host injects connection later)
    assert.equal(clientCode.includes('const rpc = ctx.connection.rpc'), false)
    assert.equal(clientCode.includes('conn && conn.rpc'), true)
    assert.equal(clientCode.includes('rpc.call(MARKET_RPC_CHANNEL'), true)
    // Custom centered modal dialogs (no native window.confirm)
    assert.equal(clientCode.includes('window.confirm('), false)
    assert.equal(clientCode.includes('dm-modal-scrim'), true)
    assert.equal(clientCode.includes('dm-modal-card'), true)
    // Parse as a Function so syntax errors in client.js fail the suite
    new Function('window', clientCode)
    // Dedicated SVG icons replacing emojis
    assert.equal(clientCode.includes('IconRocket'), true)
    assert.equal(clientCode.includes('IconTrash'), true)
    assert.equal(clientCode.includes('IconRefresh'), true)
    assert.equal(clientCode.includes('IconSearch'), true)
    // Custom switch toggle for autoCheckUpdates setting
    assert.equal(clientCode.includes('dm-switch-row'), true)
    assert.equal(clientCode.includes('dm-slider'), true)
    // Every askConfirm invocation MUST be immediately followed by `if (!ok) return;`
    const askConfirmCount = (clientCode.match(/await askConfirm\(/g) || []).length
    const okGuardCount = (clientCode.match(/if \(!ok\) return;/g) || []).length
    assert.ok(askConfirmCount >= 3)
    assert.equal(okGuardCount, askConfirmCount, 'Every askConfirm must guard cancellation with `if (!ok) return;`')
    // Portal to document.body to bypass transformed drawer container clipping
    assert.equal(clientCode.includes('createPortal(modalNode, document.body)'), true)
  })

  it('cordis patch entry id matches the host-side service name', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const index = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    assert.equal(patch.includes('id: plugin-manager'), true)
    assert.equal(index.includes("export const name = 'plugin-manager'"), true)
  })
})

describe('dsh-market community catalog normalization', () => {
  const RAW = {
    updated: '2026-08-27',
    categories: {
      ui: { en: 'UI Enhancements', zh: 'UI 增强' },
      model: { en: 'Models & Providers', zh: '模型与账号接入' },
    },
    plugins: [
      {
        name: 'dsh-status-rotator',
        owner: '01Virex',
        url: 'https://github.com/01Virex/dsh-status-rotator',
        category: 'ui',
        description: { en: 'Rotating status phrases', zh: '轮换状态文案' },
        npm: 'dsh-status-rotator',
        stars: 55,
        downloads: 2436,
        added: '2026-08-14',
      },
      {
        name: 'plugin-without-npm',
        category: 'model',
        description: 'Plain string description',
      },
    ],
  }

  it('normalizes entries to card fields (zh description, stars, npm)', () => {
    const list = normalizeCommunityPlugins(RAW, 'zh')
    assert.equal(list.length, 2)
    const first = list[0]
    assert.equal(first.title, 'dsh-status-rotator')
    assert.equal(first.description, '轮换状态文案')
    assert.equal(first.category, 'ui')
    assert.equal(first.stars, 55)
    assert.equal(first.downloads, 2436)
    assert.equal(first.npm, 'dsh-status-rotator')
    assert.equal(first.author, '01Virex')
    // fallback for string descriptions
    assert.equal(list[1].description, 'Plain string description')
    assert.equal(list[1].npm, '')
  })

  it('normalizes garbage payloads to empty arrays', () => {
    assert.deepEqual(normalizeCommunityPlugins(null), [])
    assert.deepEqual(normalizeCommunityPlugins({}), [])
    assert.deepEqual(normalizeCommunityPlugins({ plugins: 'nope' }), [])
  })

  it('extracts the category dictionary', () => {
    const cats = communityCategories(RAW)
    assert.deepEqual(cats, [
      { id: 'ui', en: 'UI Enhancements', zh: 'UI 增强' },
      { id: 'model', en: 'Models & Providers', zh: '模型与账号接入' },
    ])
    assert.deepEqual(communityCategories(null), [])
  })
})

describe('dsh-market install source allowlist', () => {
  it('accepts monorepo release download URLs for the configured origin', () => {
    const url = 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz'
    assert.equal(isAllowedRepoUrl(url, 'veildawn/dsh-plugins'), true)
    // URL-encoded @ form is also accepted
    assert.equal(isAllowedRepoUrl(url.replace('@', '%40'), 'veildawn/dsh-plugins'), true)
    // Mirror URL is accepted when mirrorUrl prefix is supplied
    const mirror = 'https://gh-proxy.com/'
    assert.equal(isAllowedRepoUrl(url.replace('https://github.com/', mirror), 'veildawn/dsh-plugins', mirror), true)
  })

  it('rejects foreign origins, wrong shapes and hand-crafted URLs', () => {
    assert.equal(isAllowedRepoUrl('https://github.com/evil/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz', 'veildawn/dsh-plugins'), false)
    assert.equal(isAllowedRepoUrl('https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/evil-0.4.8.tgz', 'veildawn/dsh-plugins'), false)
    assert.equal(isAllowedRepoUrl('https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.9.tgz', 'veildawn/dsh-plugins'), false)
    assert.equal(isAllowedRepoUrl('https://evil.com/x.tgz', 'veildawn/dsh-plugins'), false)
    assert.equal(isAllowedRepoUrl(42, 'veildawn/dsh-plugins'), false)
  })

  it('sanitizes profile and package names', () => {
    assert.equal(safeProfileName('web'), 'web')
    assert.equal(safeProfileName('web;rm -rf /'), null)
    assert.equal(safeProfileName(''), null)
    assert.equal(safePackageName('dsh-status-rotator'), 'dsh-status-rotator')
    assert.equal(safePackageName('@scope/pkg-name'), '@scope/pkg-name')
    assert.equal(safePackageName('pkg; rm -rf /'), null)
    assert.equal(safePackageName('../evil'), null)
  })
})

describe('dsh-market install tasks (fake spawn)', () => {
  const FAKE_RELEASES = [
    {
      tag_name: 'dsh-model-roles@v0.4.8',
      published_at: '2026-08-26T22:32:00Z',
      assets: [{ name: 'dsh-model-roles-0.4.8.tgz', browser_download_url: 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz' }],
    },
  ]
  const FAKE_COMMUNITY = {
    plugins: [
      { name: 'dsh-status-rotator', npm: 'dsh-status-rotator', category: 'ui', description: { zh: '轮换状态文案' } },
      { name: 'no-npm-plugin', category: 'ui', description: { zh: '无 npm 包' } },
    ],
    categories: { ui: { en: 'UI', zh: 'UI' } },
  }
  let originalFetch
  const captured = { calls: [] }
  let testHome
  const originalDshHome = process.env.DSH_HOME

  function fakeSpawn(cmd, args, opts) {
    captured.calls.push({ cmd, args })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('installing...\n'))
      child.emit('close', 0)
    })
    return child
  }

  before(() => {
    // Isolate DSH_HOME so install/repair never touches the real profile lockfile.
    testHome = mkdtempSync(join(tmpdir(), 'dsh-install-test-'))
    const profileDir = join(testHome, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    process.env.DSH_HOME = testHome
    resetMarketCaches()
    _setHttpFetch(async (url) => {
      if (String(url).includes('api.github.com')) return { ok: true, json: async () => FAKE_RELEASES }
      if (String(url).includes('plugins.json')) return { ok: true, json: async () => FAKE_COMMUNITY }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  })
  after(() => {
    _resetHttpFetch()
    if (originalDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalDshHome
    rmSync(testHome, { recursive: true, force: true })
  })

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  async function waitForTask(rpc, taskId, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const res = await rpc('getInstallTask', { taskId })
      if (res.status !== 'running') return res
      await sleep(20)
    }
    throw new Error('task did not finish in time')
  }

  it('installs a repo plugin by spawning `dsh plugin add` with the allowlisted URL', async () => {
    captured.calls.length = 0
    const res = handleInstallPlugin({}, { name: 'dsh-model-roles', kind: 'repo' }, { spawnFn: fakeSpawn })
    assert.equal(res.ok, true)
    const task = await waitForTask(async (m, p) => (await handleMarketRpc({}, {}, m, p)).value, res.value.taskId)
    assert.equal(task.status, 'success')
    assert.equal(task.profile, 'web')
    assert.equal(captured.calls.length, 1)
    assert.equal(captured.calls[0].cmd, 'dsh')
    assert.deepEqual(captured.calls[0].args, ['plugin', 'add', '--profile', 'web', 'https://github.com/veildawn/dsh-plugins/releases/download/dsh-model-roles@v0.4.8/dsh-model-roles-0.4.8.tgz'])
    assert.equal(task.log.some((l) => l.includes('$ dsh plugin add')), true)
    assert.equal(task.log.some((l) => l.includes('installing...')), true)
  })

  it('installs a community plugin by spawning `dsh plugin add` with its npm name', async () => {
    captured.calls.length = 0
    const res = handleInstallPlugin({}, { name: 'dsh-status-rotator', kind: 'community' }, { spawnFn: fakeSpawn })
    assert.equal(res.ok, true)
    const task = await waitForTask(async (m, p) => (await handleMarketRpc({}, {}, m, p)).value, res.value.taskId)
    assert.equal(task.status, 'success')
    assert.equal(captured.calls[0].args[4], 'dsh-status-rotator')
  })

  it('rejects plugins not present in the catalogs (no spawn)', async () => {
    captured.calls.length = 0
    const res = handleInstallPlugin({}, { name: 'not-in-catalog', kind: 'repo' }, { spawnFn: fakeSpawn })
    assert.equal(res.ok, true)
    const task = await waitForTask(async (m, p) => (await handleMarketRpc({}, {}, m, p)).value, res.value.taskId)
    assert.equal(task.status, 'error')
    assert.equal(captured.calls.length, 0)
  })

  it('rejects community plugins without an npm package', async () => {
    captured.calls.length = 0
    const res = handleInstallPlugin({}, { name: 'no-npm-plugin', kind: 'community' }, { spawnFn: fakeSpawn })
    assert.equal(res.ok, true)
    const task = await waitForTask(async (m, p) => (await handleMarketRpc({}, {}, m, p)).value, res.value.taskId)
    assert.equal(task.status, 'error')
    assert.equal(captured.calls.length, 0)
  })

  it('rejects malformed install requests and unknown kinds', () => {
    const bad = handleInstallPlugin({}, {}, { spawnFn: fakeSpawn })
    assert.equal(bad.ok, false)
    const noName = handleInstallPlugin({}, { kind: 'repo' }, { spawnFn: fakeSpawn })
    assert.equal(noName.ok, false)
    const badKind = handleInstallPlugin({}, { name: 'x', kind: 'npm' }, { spawnFn: fakeSpawn })
    assert.equal(badKind.ok, false)
  })

  it('only allows one install task at a time', async () => {
    // Hold the first task open with a spawn that never closes.
    let stuckChild
    const stuckSpawn = () => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      stuckChild = child
      return child
    }
    const first = handleInstallPlugin({}, { name: 'dsh-model-roles', kind: 'repo' }, { spawnFn: stuckSpawn })
    assert.equal(first.ok, true)
    // The second request must be refused while the first is running.
    const second = handleInstallPlugin({}, { name: 'dsh-terminal', kind: 'repo' }, { spawnFn: fakeSpawn })
    assert.equal(second.ok, false)
    assert.match(second.error.message, /已有.*任务正在进行/)
    // The async task reaches the spawn after resolveInstallSource resolves.
    await sleep(100)
    assert.ok(stuckChild, 'first task should have spawned by now')
    // Release the first task and let it finish, then a new task is allowed.
    stuckChild.emit('close', 0)
    await sleep(150)
    const third = handleInstallPlugin({}, { name: 'dsh-terminal', kind: 'repo' }, { spawnFn: fakeSpawn })
    assert.equal(third.ok, true)
    const task = await waitForTask(async (m, p) => (await handleMarketRpc({}, {}, m, p)).value, third.value.taskId)
    assert.equal(task.status, 'success')
  })

  it('runDshPluginCommand passes shell: true on Windows and captures exit code', async () => {
    let capturedOpts = null
    const failing = new EventEmitter()
    failing.stdout = new EventEmitter()
    failing.stderr = new EventEmitter()
    failing.kill = () => {}
    setImmediate(() => {
      failing.stderr.emit('data', Buffer.from('boom\n'))
      failing.emit('close', 1)
    })
    const result = await runDshPluginCommand(['plugin', 'add', 'x'], {
      spawnFn: (cmd, args, opts) => {
        capturedOpts = opts
        return failing
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 1)
    assert.equal(result.stderr.includes('boom'), true)
    assert.equal(capturedOpts.shell, process.platform === 'win32')
  })

  it('removes an installed plugin by spawning `dsh plugin remove`', async () => {
    await sleep(100)
    captured.calls.length = 0
    const res = handleRemovePlugin({}, { name: 'dsh-model-roles' }, { spawnFn: fakeSpawn })
    assert.equal(res.ok, true)
    const task = await waitForTask(async (m, p) => (await handleMarketRpc({}, {}, m, p)).value, res.value.taskId)
    assert.equal(task.status, 'success')
    assert.equal(task.kind, 'remove')
    assert.equal(captured.calls.length, 1)
    assert.equal(captured.calls[0].cmd, 'dsh')
    assert.deepEqual(captured.calls[0].args, ['plugin', 'remove', '--profile', 'web', 'dsh-model-roles'])
    assert.equal(task.log.some((l) => l.includes('$ dsh plugin remove')), true)
  })

  it('rejects invalid plugin names for removePlugin', () => {
    const bad = handleRemovePlugin({}, { name: 'bad;rm -rf /' }, { spawnFn: fakeSpawn })
    assert.equal(bad.ok, false)
    const empty = handleRemovePlugin({}, {}, { spawnFn: fakeSpawn })
    assert.equal(empty.ok, false)
  })

  it('runs batch update on repo plugins with available updates', async () => {
    await sleep(100)
    captured.calls.length = 0
    const res = handleBatchUpdatePlugins({}, { kind: 'repo' }, { spawnFn: fakeSpawn })
    assert.equal(res.ok, true)
    const task = await waitForTask(async (m, p) => (await handleMarketRpc({}, {}, m, p)).value, res.value.taskId)
    assert.equal(task.status, 'success')
    assert.equal(task.kind, 'batch-update')
    assert.equal(task.log.some((l) => l.includes('批量更新') || l.includes('无需更新')), true)
  })

  function withPlatform(platform, fn) {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: platform })
    try {
      return fn()
    } finally {
      Object.defineProperty(process, 'platform', { value: original })
    }
  }

  function fakeChild() {
    const child = new EventEmitter()
    child.unref = () => {}
    return child
  }

  it('schedules async host restart via systemd transient scope', () => {
    withPlatform('linux', () => {
      const calls = []
      const fakeRestartSpawn = (cmd, args) => {
        calls.push({ cmd, args })
        return fakeChild()
      }
      const fakeProbe = () => ({ status: 0, error: null }) // systemctl status dsh-web -> active
      const res = handleRestartHost({}, {}, { spawnFn: fakeRestartSpawn, spawnSyncFn: fakeProbe })
      assert.equal(res.ok, true)
      assert.equal(res.value.scheduled, true)
      assert.equal(res.value.method, 'systemd')
      assert.equal(calls.length, 1)
      assert.equal(calls[0].cmd, 'systemd-run')
      assert.equal(calls[0].args[0], '--no-block')
      assert.match(calls[0].args.join(' '), /systemctl restart dsh-web/)
    })
  })

  it('refuses restart when systemd unit does not exist', () => {
    withPlatform('linux', () => {
      const fakeProbe = () => ({ status: 4, error: null }) // unit not found
      const res = handleRestartHost({}, {}, {
        spawnFn: () => { throw new Error('should not spawn') },
        spawnSyncFn: fakeProbe,
      })
      assert.equal(res.ok, false)
      assert.equal(res.error.code, 'restart-unavailable')
      assert.match(res.error.message, /不存在/)
    })
  })

  it('refuses restart when systemctl is unavailable', () => {
    withPlatform('linux', () => {
      const fakeProbe = () => ({ status: null, error: new Error('ENOENT') })
      const res = handleRestartHost({}, {}, {
        spawnFn: () => { throw new Error('should not spawn') },
        spawnSyncFn: fakeProbe,
      })
      assert.equal(res.ok, false)
      assert.equal(res.error.code, 'restart-unavailable')
    })
  })

  it('schedules async host restart on macOS via launchd gui domain', () => {
    withPlatform('darwin', () => {
      const calls = []
      const prints = []
      const fakeRestartSpawn = (cmd, args) => {
        calls.push({ cmd, args })
        return fakeChild()
      }
      const fakeProbe = (cmd, args) => {
        prints.push({ cmd, args })
        if (cmd === 'launchctl' && args[0] === 'print' && String(args[1]).startsWith('gui/')) {
          return { status: 0, error: null }
        }
        return { status: 113, error: null }
      }
      const res = handleRestartHost({}, {}, {
        spawnFn: fakeRestartSpawn,
        spawnSyncFn: fakeProbe,
      })
      assert.equal(res.ok, true)
      assert.equal(res.value.scheduled, true)
      assert.equal(res.value.method, 'macos-launchd')
      assert.equal(res.value.serviceName, 'com.deepseek.dsh-web')
      assert.match(res.value.domainTarget, /^gui\/\d+\/com\.deepseek\.dsh-web$/)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].cmd, '/bin/sh')
      assert.equal(calls[0].args[1], 'sleep 0.8 && exec launchctl kickstart -k "$1"')
      assert.equal(calls[0].args[3], res.value.domainTarget)
      assert.equal(prints[0].args[1], res.value.domainTarget)
    })
  })

  it('schedules async host restart on macOS via launchd user domain when gui is missing', () => {
    withPlatform('darwin', () => {
      const calls = []
      const fakeRestartSpawn = (cmd, args) => {
        calls.push({ cmd, args })
        return fakeChild()
      }
      const fakeProbe = (cmd, args) => {
        if (cmd === 'launchctl' && args[0] === 'print' && String(args[1]).startsWith('user/')) {
          return { status: 0, error: null }
        }
        return { status: 113, error: null }
      }
      const res = handleRestartHost({}, { serviceName: 'com.deepseek.dsh-web' }, {
        spawnFn: fakeRestartSpawn,
        spawnSyncFn: fakeProbe,
      })
      assert.equal(res.ok, true)
      assert.equal(res.value.method, 'macos-launchd')
      assert.match(res.value.domainTarget, /^user\/\d+\/com\.deepseek\.dsh-web$/)
      assert.equal(calls[0].args[3], res.value.domainTarget)
    })
  })

  it('falls back to process self-respawn on macOS when launchd is not configured', () => {
    withPlatform('darwin', () => {
      const originalRepo = process.env.DSH_PLUGINS_REPO
      delete process.env.DSH_PLUGINS_REPO
      const calls = []
      try {
        const res = handleRestartHost({}, {}, {
          spawnFn: (cmd, args, opts) => {
            calls.push({ cmd, args, opts })
            return { unref: () => {} }
          },
          spawnSyncFn: () => ({ status: 113, error: null }),
        })
        assert.equal(res.ok, true)
        assert.equal(res.value.scheduled, true)
        assert.equal(res.value.method, 'macos-respawn')
        assert.match(res.value.message, /自重启/)
        assert.equal(calls.length, 1)
        assert.equal(calls[0].cmd, '/bin/sh')
        assert.equal(calls[0].opts.detached, true)
      } finally {
        if (originalRepo === undefined) delete process.env.DSH_PLUGINS_REPO
        else process.env.DSH_PLUGINS_REPO = originalRepo
      }
    })
  })

  it('falls back to process self-respawn when launchctl fails with an error', () => {
    withPlatform('darwin', () => {
      const originalRepo = process.env.DSH_PLUGINS_REPO
      delete process.env.DSH_PLUGINS_REPO
      const calls = []
      try {
        const res = handleRestartHost({}, {}, {
          spawnFn: (cmd, args, opts) => {
            calls.push({ cmd, args, opts })
            return { unref: () => {} }
          },
          spawnSyncFn: () => ({ status: null, error: new Error('ENOENT') }),
        })
        assert.equal(res.ok, true)
        assert.equal(res.value.method, 'macos-respawn')
      } finally {
        if (originalRepo === undefined) delete process.env.DSH_PLUGINS_REPO
        else process.env.DSH_PLUGINS_REPO = originalRepo
      }
    })
  })

  it('schedules macOS script restart only when DSH_PLUGINS_REPO is set', () => {
    withPlatform('darwin', () => {
      const originalRepo = process.env.DSH_PLUGINS_REPO
      const repoDir = mkdtempSync(join(tmpdir(), 'dsh-pm-repo-'))
      mkdirSync(join(repoDir, 'scripts'))
      writeFileSync(join(repoDir, 'scripts/dsh-web.sh'), '#!/bin/sh\n', 'utf8')
      process.env.DSH_PLUGINS_REPO = repoDir
      try {
        const calls = []
        const res = handleRestartHost({}, {}, {
          spawnFn: (cmd, args) => {
            calls.push({ cmd, args })
            return fakeChild()
          },
          spawnSyncFn: () => ({ status: 113, error: null }),
        })
        assert.equal(res.ok, true)
        assert.equal(res.value.method, 'macos-script')
        assert.equal(calls.length, 1)
        assert.equal(calls[0].cmd, '/bin/sh')
        assert.equal(calls[0].args[1], 'sleep 0.8 && exec "$1" restart')
        assert.equal(calls[0].args[3], join(repoDir, 'scripts/dsh-web.sh'))
      } finally {
        rmSync(repoDir, { recursive: true, force: true })
        if (originalRepo === undefined) delete process.env.DSH_PLUGINS_REPO
        else process.env.DSH_PLUGINS_REPO = originalRepo
      }
    })
  })
})

describe('dsh-market DSH host update detection', () => {
  it('parses DSH release tags correctly', () => {
    assert.equal(parseDshReleaseTag('dsh-v0.1.5-rc.1'), '0.1.5-rc.1')
    assert.equal(parseDshReleaseTag('v0.1.5-rc.1'), '0.1.5-rc.1')
    assert.equal(parseDshReleaseTag('0.1.5-rc.1'), '0.1.5-rc.1')
    assert.equal(parseDshReleaseTag('dsh-0.2.0'), '0.2.0')
    assert.equal(parseDshReleaseTag('not-a-tag'), null)
    assert.equal(parseDshReleaseTag(null), null)
  })

  it('reads host DSH version via spawnFn or args', () => {
    const fakeSpawn = () => ({
      status: 0,
      stdout: '0.1.5-rc.1\n',
      stderr: '',
    })
    assert.equal(readHostDshVersion({ spawnFn: fakeSpawn, processArgs: [] }), '0.1.5-rc.1')

    const failSpawn = () => ({ status: 1, stdout: '', stderr: 'error' })
    assert.equal(readHostDshVersion({ spawnFn: failSpawn, processArgs: [] }), null)
  })

  it('checks DSH update state correctly', () => {
    const upToDate = checkDshUpdate({ currentVersion: '0.1.5-rc.1', latestVersion: '0.1.5-rc.1' })
    assert.equal(upToDate.hasUpdate, false)
    assert.equal(upToDate.currentVersion, '0.1.5-rc.1')
    assert.equal(upToDate.latestVersion, '0.1.5-rc.1')

    const hasUpdate = checkDshUpdate({ currentVersion: '0.1.2-rc.1', latestVersion: '0.1.5-rc.1' })
    assert.equal(hasUpdate.hasUpdate, true)

    const prereleaseUpdate = checkDshUpdate({ currentVersion: '0.1.5-rc.1', latestVersion: '0.1.5-rc.2' })
    assert.equal(prereleaseUpdate.hasUpdate, true)

    const missing = checkDshUpdate({ currentVersion: null, latestVersion: '0.1.5-rc.1' })
    assert.equal(missing.hasUpdate, false)
  })

  it('queries DSH update with stubbed fetch and spawn', async () => {
    // Fully stubbed: this test previously reached the live npm registry and
    // GitHub, so its hardcoded expectation broke every time a new DSH release
    // was published (e.g. 0.1.5-rc.1 -> 0.1.5-rc.3) without any code regression.
    const urls = []
    _setHttpFetch(async (url) => {
      urls.push(url)
      if (url.includes('registry.npmjs.org')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ 'dist-tags': { latest: '0.1.5-rc.1' }, time: { '0.1.5-rc.1': '2026-01-01T00:00:00.000Z' } }),
        }
      }
      return { ok: true, status: 200, json: async () => [] }
    })
    try {
      resetMarketCaches()
      const fakeSpawn = () => ({ status: 0, stdout: '0.1.2-rc.1\n' })
      const res = await queryDshUpdate({ spawnFn: fakeSpawn })
      assert.equal(res.name, '@deepseek-ai/dsh')
      assert.equal(res.currentVersion, '0.1.2-rc.1')
      assert.equal(res.latestVersion, '0.1.5-rc.1')
      assert.equal(res.hasUpdate, true)
      assert.equal(res.releaseUrl.includes('deepseek-harness'), true)
      assert.equal(urls.some((u) => u.includes('registry.npmjs.org')), true, 'must query the npm registry')
    } finally {
      _resetHttpFetch()
      resetMarketCaches()
    }
  })
})

/**
 * Regression guard for:
 *   「DSH 有更新时，'复制更新命令' 按钮点击后未起作用」
 *
 * The button used to call `navigator.clipboard.writeText(cmd)` fire-and-forget
 * inside a synchronous try/catch. The Clipboard API is promise-based, so a
 * rejection (permission denied / document unfocused / API absent) escaped that
 * try/catch, the execCommand fallback never ran, and no feedback was rendered —
 * a button that visibly did nothing. These tests render the real component and
 * click the real rendered button against a minimal DOM.
 */
describe('dsh-plugin-manager DSH update banner copy command', () => {
  const DSH_CMD = 'npm install -g @deepseek-ai/dsh'
  const DSH_PAYLOAD = {
    currentVersion: '0.1.2-rc.1',
    latestVersion: '0.1.5-rc.1',
    hasUpdate: true,
    releaseUrl: 'https://example.test/release',
  }

  /**
   * Map every `const [name, setName] = react.useState(...)` to its name. The
   * hook shim below is keyed by these names, so reordering or inserting a hook
   * can never silently point the test at the wrong state slot.
   */
  const CLIENT_SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const STATE_SLOTS = [...CLIENT_SOURCE.matchAll(/const \[(\w+), set\w+\] = react\.useState\(/g)]
    .map((match) => match[1])

  const findNode = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    const children = node.props ? node.props.children : null
    const list = Array.isArray(children) ? children : (children == null ? [] : [children])
    for (const child of list) {
      const hit = findNode(child, predicate)
      if (hit) return hit
    }
    return null
  }

  /** Static createElement stores children as an array, so join the text bits. */
  const labelOf = (node) => {
    const children = node.props ? node.props.children : null
    const list = Array.isArray(children) ? children : [children]
    return list.filter((child) => typeof child === 'string').join('')
  }

  const findButton = (tree, predicate) =>
    findNode(tree, (n) => n.type === 'button' && typeof n.props?.onClick === 'function' && predicate(n))

  const bannerCopyButton = (tree) => findButton(tree, (n) => labelOf(n) === '复制更新命令')
  const copiedBannerButton = (tree) => findButton(tree, (n) => labelOf(n) === '✓ 已复制')
  const badgeCopyButton = (tree) => findButton(tree, (n) =>
    typeof n.props.className === 'string'
    && n.props.className.includes('dm-dsh-badge')
    && labelOf(n).includes('可更新'))

  const clickCopyButton = async ({ clipboard, execCommand, button = 'banner', dshUpdate = DSH_PAYLOAD }) => {
    // Record process-level rejections: the old implementation leaked one, which
    // is precisely why the click produced no visible result.
    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

    // Capture every timer so the 2s "已复制" reset can be fired on demand.
    const timers = []
    const windowStub = {
      setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length },
      clearTimeout: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      clearInterval: () => {},
      setInterval: () => 0,
    }

    const copied = []
    let execCalls = 0
    // apply() injects a <style> node via document.getElementById/head, and the
    // execCommand fallback builds an offscreen <textarea> with focus/select.
    const fakeDocument = {
      getElementById: () => null,
      head: { appendChild: () => {} },
      body: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({
        style: {},
        value: '',
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
      }),
      execCommand: (cmd) => {
        execCalls += 1
        if (execCommand) return execCommand(cmd)
        copied.push(DSH_CMD)
        return true
      },
    }

    // `navigator` / `document` / `window` are getter-only accessors on modern
    // Node globals, so assignment throws — swap the descriptors instead.
    Object.defineProperty(globalThis, 'window', { value: windowStub, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true, writable: true })

    try {
      const store = { dshUpdate, feedback: '', feedbackKind: 'ok' }
      const renders = []
      let hookIndex = 0

      const fakeReact = {
        Fragment: 'Fragment',
        createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
        useEffect: () => {},
        useMemo: (fn) => fn(),
        useRef: (init) => ({ current: init }),
        // The bundle calls `react.useCallback(fn)` and invokes the result with
        // an argument, so hand the raw function back (arity preserved).
        useCallback: (fn) => fn,
        useState: (init) => {
          const name = STATE_SLOTS[hookIndex++]
          const has = Object.prototype.hasOwnProperty.call(store, name)
          const current = has ? store[name] : (typeof init === 'function' ? init() : init)
          if (!has) store[name] = current
          return [current, (value) => {
            store[name] = typeof value === 'function' ? value(store[name]) : value
            render()
          }]
        },
      }

      const plugin = capturedPluginDefinition.factory((id) => {
        if (id === 'react') return fakeReact
        if (id === 'react-dom') return { createPortal: (node) => node }
        if (id === '@deepseek-ai/dsh-client-ui-primitives') {
          return new Proxy({}, { get: () => () => ({ type: 'icon' }) })
        }
        return {}
      })

      const slots = []
      plugin.apply({
        slots: { inject: (slot, fn) => fn(), register: (entry, comp) => slots.push({ entry, comp }) },
        connection: {
          rpc: {
            call: async (channel, method) => {
              if (method === 'getDshUpdate') return dshUpdate
              if (method === 'getRepoPlugins') return { plugins: [], repoOrigin: 'veildawn/dsh-plugins', profile: 'web' }
              if (method === 'getConfig') return {}
              if (method === 'getCommunityPlugins') return { plugins: [] }
              return {}
            },
          },
        },
        remote: { $on: () => () => {} },
      })

      const render = () => {
        hookIndex = 0
        const tree = slots[0].comp({})
        renders.push(tree)
        return tree
      }

      const tree = render()
      const btn = button === 'badge' ? badgeCopyButton(tree) : bannerCopyButton(tree)
      assert.ok(btn, `the ${button} copy button must be rendered for the update banner`)

      await btn.props.onClick()
      await new Promise((resolve) => setImmediate(resolve))

      // Let the loadDshUpdate RPC promise settle so state-driven renders land.
      await new Promise((resolve) => setImmediate(resolve))

      return {
        copied,
        execCalls,
        unhandled,
        store,
        timers,
        renders,
        latest: () => renders[renders.length - 1],
      }
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else delete globalThis.window
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
      else delete globalThis.navigator
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
      else delete globalThis.document
    }
  }

  it('banner button writes the update command to the clipboard and reports success', async () => {
    const writes = []
    const { store, unhandled } = await clickCopyButton({
      clipboard: { writeText: async (text) => { writes.push(text) } },
      execCommand: null,
    })
    assert.deepEqual(writes, [DSH_CMD])
    assert.equal(store.feedbackKind, 'ok')
    assert.equal(store.feedback.includes(DSH_CMD), true, 'success toast must contain the command')
    assert.equal(unhandled.length, 0, 'copy must not leak an unhandled rejection')
  })

  it('falls back to execCommand when the clipboard API is missing (no dead click)', async () => {
    const { copied, execCalls, store, unhandled } = await clickCopyButton({
      clipboard: undefined,
      execCommand: null,
    })
    assert.deepEqual(copied, [DSH_CMD], 'execCommand fallback must run when clipboard is unavailable')
    assert.equal(execCalls >= 1, true)
    assert.equal(store.feedbackKind, 'ok')
    assert.equal(unhandled.length, 0)
  })

  it('falls back to execCommand when clipboard.writeText rejects (the reported dead-button path)', async () => {
    const { copied, store, unhandled } = await clickCopyButton({
      clipboard: { writeText: async () => { throw new Error('NotAllowedError: Document is not focused') } },
      execCommand: null,
    })
    assert.deepEqual(copied, [DSH_CMD], 'rejected writeText must fall back to execCommand')
    assert.equal(store.feedbackKind, 'ok')
    assert.equal(unhandled.length, 0, 'fire-and-forget writeText rejection previously escaped the try/catch')
  })

  it('surfaces a manual-copy error toast when every clipboard path fails', async () => {
    const { store, unhandled } = await clickCopyButton({
      clipboard: { writeText: async () => { throw new Error('NotAllowedError') } },
      execCommand: () => false,
    })
    assert.equal(store.feedbackKind, 'error')
    assert.equal(store.feedback.includes('复制失败'), true)
    assert.equal(store.feedback.includes(DSH_CMD), true, 'failure toast must still expose the command')
    assert.equal(unhandled.length, 0)
  })

  it('badge button shares the same robust copy path', async () => {
    const writes = []
    const { store, unhandled } = await clickCopyButton({
      clipboard: { writeText: async (text) => { writes.push(text) } },
      execCommand: null,
      button: 'badge',
    })
    assert.deepEqual(writes, [DSH_CMD])
    assert.equal(store.feedbackKind, 'ok')
    assert.equal(unhandled.length, 0)
  })

  it('shows immediate in-button feedback and resets it on the 2s timer', async () => {
    const { latest, timers, unhandled } = await clickCopyButton({
      clipboard: { writeText: async () => {} },
      execCommand: null,
    })
    assert.ok(copiedBannerButton(latest()), 'button must switch to the "✓ 已复制" state right after a successful copy')
    assert.equal(timers.some((t) => t.delay === 2000), true, 'the copied state must be reset by a 2000ms timer')
    for (const timer of timers.filter((t) => t.delay === 2000)) timer.fn()
    assert.ok(bannerCopyButton(latest()), 'button must return to "复制更新命令" once the timer fires')
    assert.equal(unhandled.length, 0)
  })

  it('renders the banner from the loadDshUpdate RPC payload', async () => {
    const writes = []
    // Note: the harness already clicked the copy button, so this assertion runs
    // against renders rather than the live tree — after a successful copy the
    // banner button is intentionally replaced by the "✓ 已复制" state.
    const { renders, unhandled } = await clickCopyButton({
      clipboard: { writeText: async (text) => { writes.push(text) } },
      execCommand: null,
    })
    assert.deepEqual(writes, [DSH_CMD], 'the payload-driven banner button must copy the update command')
    const banner = renders
      .map((tree) => findNode(tree, (n) =>
        typeof n.props?.className === 'string' && n.props.className.includes('dm-dsh-banner')))
      .find(Boolean)
    assert.ok(banner, 'the update banner must render when getDshUpdate reports hasUpdate')
    const copyLabel = findNode(banner, (n) => n.type === 'button' && labelOf(n) === '复制更新命令')
    assert.ok(copyLabel, 'the payload-driven banner must expose a "复制更新命令" button')
    assert.equal(copyLabel.props.title.includes(DSH_CMD), true, 'button title must document the exact command')
    assert.equal(unhandled.length, 0)
  })

  it('client bundle keeps the raw clipboard write inside the shared helper only', () => {
    const calls = CLIENT_SOURCE.split('navigator.clipboard.writeText').length - 1
    // Shared copyText() holds the only guard + awaited write; the third
    // occurrence is its explanatory doc comment.
    assert.equal(calls, 3, 'raw navigator.clipboard.writeText must live only in the shared helper')
    assert.equal(CLIENT_SOURCE.includes('const copyText = async (text)'), true)
    assert.equal(CLIENT_SOURCE.includes('await navigator.clipboard.writeText(text)'), true)
    assert.equal(CLIENT_SOURCE.includes('document.execCommand("copy")'), true)
  })

  it('keeps the state slot names used by this suite stable', () => {
    for (const name of ['dshUpdate', 'feedback', 'feedbackKind']) {
      assert.equal(STATE_SLOTS.includes(name), true, `client.js must keep a useState named ${name}`)
    }
  })
})
