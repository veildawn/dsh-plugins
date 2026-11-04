/**
 * Reconcile the image's bundled plugins into the mounted profile.
 *
 * A volume at DSH_HOME hides whatever `dsh plugin add` wrote during the image
 * build. An empty bind mount or PVC therefore has no profile, and a volume
 * kept from an older image keeps the old plugin versions. Tarballs stay
 * outside the volume. This installs only the bundles whose installed version
 * differs, which leaves the profile's cordis.patch.yml and other user files
 * in place (`dsh plugin add` updates the package, not that patch layer).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BUNDLED_PLUGIN_DIR = '/opt/dsh-plugins'
export const BUNDLED_PLUGINS = [
  'dsh-mobile-adapter.tgz',
  'dsh-remote-control.tgz',
  'dsh-ai-proxy.tgz',
]
// The image installs this profile against the store on the container
// filesystem. A bind-mounted home is another device, and pnpm then tries to
// move the store onto that mount and aborts. Pinning --store-dir keeps updates
// on the store the image already populated.
export const DEFAULT_PNPM_STORE = '/home/node/.local/share/pnpm/store'

export function pluginAddArgs(tarball, storeDir = DEFAULT_PNPM_STORE) {
  return ['plugin', '--profile', 'web', 'add', '--store-dir', storeDir, tarball]
}

export function profileDir(home = process.env.DSH_HOME || '/home/node/.dsh') {
  return join(home, 'profiles', 'web')
}

export function readTarballManifest(tarball) {
  const json = execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' })
  const manifest = JSON.parse(json)
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`bundled plugin tarball is missing name or version: ${tarball}`)
  }
  return manifest
}

export function readInstalledVersion(profile, packageName) {
  const manifestPath = join(profile, 'node_modules', ...packageName.split('/'), 'package.json')
  if (!existsSync(manifestPath)) return undefined
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

export function pluginsToInstall(profile, tarballs, readManifest = readTarballManifest) {
  const pending = []
  for (const tarball of tarballs) {
    const manifest = readManifest(tarball)
    if (readInstalledVersion(profile, manifest.name) !== manifest.version) pending.push(tarball)
  }
  return pending
}

export function syncBundledPlugins({
  home = process.env.DSH_HOME || '/home/node/.dsh',
  directory = BUNDLED_PLUGIN_DIR,
  names = BUNDLED_PLUGINS,
  storeDir = DEFAULT_PNPM_STORE,
  run = (args) => execFileSync('dsh', args, { stdio: 'inherit' }),
} = {}) {
  const tarballs = names.map((name) => join(directory, name))
  const pending = pluginsToInstall(profileDir(home), tarballs)
  for (const tarball of pending) {
    run(pluginAddArgs(tarball, storeDir))
  }
  return pending
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  syncBundledPlugins()
}
