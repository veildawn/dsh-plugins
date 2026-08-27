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
    for (const [name, version] of [['dsh-model-roles', '0.4.7'], ['dsh-terminal', '0.1.9'], ['dsh-plugin-manager', '0.1.0'], ['dsh-status-rotator', '1.0.0']]) {
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

  it('enriches community catalog with local installed versions', () => {
    const raw = {
      plugins: [
        { name: 'dsh-status-rotator', npm: 'dsh-status-rotator', version: '1.2.0', category: 'ui' },
        { name: 'uninstalled-plugin', npm: 'uninstalled-plugin', version: '0.5.0', category: 'tools' },
      ],
    }
    const list = normalizeCommunityPlugins(raw, 'zh', { home, profile: 'web' })
    assert.equal(list.length, 2)
    assert.equal(list[0].installedVersion, '1.0.0')
    assert.equal(list[0].hasUpdate, true)
    assert.equal(list[1].installedVersion, null)
    assert.equal(list[1].hasUpdate, false)
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
      if (String(url).includes('api.github.com')) {
        return { ok: true, json: async () => FAKE_RELEASES }
      }
      if (String(url).includes('plugins.json')) {
        return { ok: true, json: async () => ({ plugins: FAKE_COMMUNITY }) }
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

describe('dsh-plugin-manager client bundle verification', () => {
  it('client bundle is valid and registers ModuleLoader', () => {
    const clientCode = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    assert.equal(clientCode.includes('window.__ModuleLoader__.load'), true)
    assert.equal(clientCode.includes('id: "dsh-plugin-manager"'), true)
    assert.equal(clientCode.includes('IconPluginManager16'), true)
    assert.equal(clientCode.includes('const rpc = ctx.connection.rpc'), true)
    assert.equal(clientCode.includes('rpc.call(MARKET_RPC_CHANNEL'), true)
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
    resetMarketCaches()
    _setHttpFetch(async (url) => {
      if (String(url).includes('api.github.com')) return { ok: true, json: async () => FAKE_RELEASES }
      if (String(url).includes('plugins.json')) return { ok: true, json: async () => FAKE_COMMUNITY }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  })
  after(() => { _resetHttpFetch() })

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

  it('runDshPluginCommand captures exit code and streamed output', async () => {
    const failing = new EventEmitter()
    failing.stdout = new EventEmitter()
    failing.stderr = new EventEmitter()
    failing.kill = () => {}
    setImmediate(() => {
      failing.stderr.emit('data', Buffer.from('boom\n'))
      failing.emit('close', 1)
    })
    const result = await runDshPluginCommand(['plugin', 'add', 'x'], {
      spawnFn: () => failing,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 1)
    assert.equal(result.stderr.includes('boom'), true)
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

  it('schedules async host restart without throwing', () => {
    let spawnedCmd = null
    const fakeRestartSpawn = (cmd, args) => {
      spawnedCmd = { cmd, args }
      const child = new EventEmitter()
      child.unref = () => {}
      return child
    }
    const res = handleRestartHost({}, {}, { spawnFn: fakeRestartSpawn })
    assert.equal(res.ok, true)
    assert.equal(res.value.scheduled, true)
    assert.ok(res.value.method)
  })
})
