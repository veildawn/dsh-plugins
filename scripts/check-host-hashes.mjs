/**
 * Host CSS Modules hash gate for the plugin styles in this repo.
 *
 * The host's frontend is built from CSS Modules, so every class name a plugin
 * styles against carries a build-generated hash prefix:
 *
 *   .Sh0Q9G_trigger   (dsh 0.1.x, dsh-client-ui-conversation)
 *   .iWlSmW_trigger   (dsh 0.2.1-rc.2, dsh-client-ui-permission-presets)
 *
 * A host bump can move a component to another package and mint a new hash. The
 * plugin's rule then matches nothing and fails **silently** — no error, no log,
 * just the un-styled host layout. That is exactly how `0.2.1-rc.2` brought the
 * mobile composer stats back (`.FJxK0a_root` → `.bOPqQW_*`) and re-attached the
 * `∨` chevron to the permission trigger (`.Sh0Q9G_*` → `.iWlSmW_*`).
 *
 * This check treats each `.<hash>_<part>` prefix as a claim: if the running host
 * ships no such prefix anywhere in its own bundles, the rule is dead.
 *
 * Prefer host-rendered stable attributes (`data-composer-stat`, `data-slot`,
 * `data-composer-card`, `[data-shortcut-modal="settings"]`) over hashes; when a
 * hash is unavoidable, keep both the old and the new prefix in the selector.
 *
 * Usage:
 *   node scripts/check-host-hashes.mjs                      # every plugin
 *   node scripts/check-host-hashes.mjs plugins/dsh-mobile-adapter
 *
 * Prints SKIP and exits 0 when no `dsh` install is on PATH, so it chains from
 * `npm test` / `scripts/release.sh` anywhere.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const USAGE = 'usage: node scripts/check-host-hashes.mjs [plugin-dir ...]';

function skip(reason) {
  console.log('SKIP ' + reason);
  process.exit(0);
}

const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { encoding: 'utf8' });
if (which.error !== undefined || which.status !== 0) skip('dsh is not installed on PATH');
const dshBin = resolve((which.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? '');
let hostRoot;
try {
  hostRoot = resolve(dirname(realpathSync(dshBin)), '..');
} catch {
  skip('the dsh on PATH is a dangling link (' + dshBin + ')');
}
const hostScope = join(hostRoot, 'node_modules', '@deepseek-ai');
if (!existsSync(hostScope)) skip('no @deepseek-ai scope next to the dsh binary');
const hostVersion = existsSync(join(hostRoot, 'package.json'))
  ? JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8')).version
  : 'unknown';

/**
 * Whether `candidate` looks like a CSS Modules hash prefix.
 *
 * CSS Modules 生成的哈希前缀一定**同时含小写字母**和（大写或数字或连字符）——
 * `iWlSmW`、`Sh0Q9G`、`pI_x6G`、`hHd-Xa` 都是这种混排。
 * 反例：全小写的作者类名（`body`、`line`）、全大写的常量（`API`、`TASK`、
 * `MOUSE`，出现在 CSS 注释和 xterm 主题名里）。这两类都不是哈希。
 * @param candidate - the part before the first underscore.
 * @returns true for hash-like prefixes.
 */
function isHashPrefix(candidate) {
  // 前缀可以是 1~8 字符：Web 版 layout 是 `pI_x6G_*`，首段只有 2 个字符。
  // 旧写法要求 5~8 字符，会把这类规则直接漏过——主题因此长期被门禁判成
  // 「0 个 hash 前缀、全部通过」，实际上一个都没检查。
  if (!/^[A-Za-z0-9-]{1,8}$/.test(candidate)) return false;
  if (!/[a-z]/.test(candidate)) return false; // 纯大写是常量，不是哈希
  return /[A-Z0-9-]/.test(candidate) || candidate.length >= 5;
}

/**
 * Collect every hash prefix the host's own bundles mention, plus known cross-build/desktop hashes.
 *
 * 桌面版（Electron，前端打在 app.asar 里）与 Web 版（`dsh web`，前端在
 * node_modules/@deepseek-ai/dsh-client-ui-*）是**两次独立构建**，同一个组件的
 * CSS Modules 哈希完全不同：`dsh web` 是 `uV2eYG_primary`，桌面版是 `Qt4Hga_primary`。
 * 主题这类插件必须同时带两套选择器，所以门禁也要认两套前缀——只扫 Web 版会把
 * 桌面版的选择器全部判成死代码，逼着作者删掉它们。
 *
 * 桌面版前端不在 dsh 安装目录里，按下面的顺序找：
 *   1. 环境变量 DSH_APP_ASAR（显式指定 app.asar）
 *   2. macOS 默认安装路径
 *   3. 仓库里的宿主类名快照 `test/fixtures/host-classes.json`——它由
 *      `scripts/harvest-host-classes.mjs --all` 从两套构建采集，两边的部件都在。
 *
 * 没有第 3 条时，Linux / CI（没有桌面版）会把**所有**桌面版选择器判成死代码，
 * 逼着作者删掉它们——那才是真的破坏桌面端：用户升级后发现主题在桌面版上
 * 一条规则都不命中。
 */
const KNOWN_CROSS_BUILD_HASHES = new Set(['ccegLa', 'NXnJXa', 'f0iH8G', 'gehEqa', 'Sh0Q9G', 'FJxK0a']);
const hostHashes = new Set(KNOWN_CROSS_BUILD_HASHES);

/**
 * 把仓库快照里记录的哈希前缀并入已知集合。
 *
 * 快照的 `modules` 映射表按 `bundle + 模块文件 + 部件名` 给出两套构建的真实
 * className；`bundles` 是采集到的全部类名。两者都读，覆盖更完整。
 * 快照缺失或损坏时静默跳过：门禁退化为「只认当前宿主」，仍然有效。
 */
function addSnapshotHashes() {
  const snapshotPath = join(REPO_ROOT, 'test', 'fixtures', 'host-classes.json');
  if (!existsSync(snapshotPath)) return;
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch {
    return;
  }
  const collect = (cls) => {
    if (typeof cls !== 'string') return;
    const prefix = cls.split('_')[0];
    if (isHashPrefix(prefix)) hostHashes.add(prefix);
  };
  for (const list of Object.values(snapshot.bundles ?? {})) {
    for (const cls of list) collect(cls);
  }
  for (const files of Object.values(snapshot.modules ?? {})) {
    for (const kinds of Object.values(files ?? {})) {
      for (const side of Object.values(kinds ?? {})) {
        for (const cls of Object.values(side ?? {})) collect(cls);
      }
    }
  }
}
addSnapshotHashes();
for (const name of readdirSync(hostScope)) {
  for (const file of ['lib/client.js', 'lib/index.js']) {
    const path = join(hostScope, name, file);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    // 前缀可能是 1~8 字符且可带连字符（`pI_x6G`、`hHd-Xa`）。
    for (const match of source.matchAll(/\.([A-Za-z0-9-]{1,8})_[A-Za-z][a-zA-Z0-9]*/g)) {
      if (isHashPrefix(match[1])) hostHashes.add(match[1]);
    }
  }
}

/** 从 app.asar 的 header 里读出所有 dsh-client-ui-* 的 client.js 内容。 */
function readAsarBundles(asarPath) {
  const fd = openSync(asarPath, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    readSync(fd, sizeBuf, 0, 8, 0);
    const headerPickleSize = sizeBuf.readUInt32LE(4);
    const headerPickle = Buffer.alloc(headerPickleSize);
    readSync(fd, headerPickle, 0, headerPickleSize, 8);
    const headerStringSize = headerPickle.readUInt32LE(4);
    const header = JSON.parse(headerPickle.subarray(8, 8 + headerStringSize).toString('utf8'));
    const dataOffset = 8 + headerPickleSize;

    const entries = [];
    const walk = (node, prefix) => {
      for (const [name, value] of Object.entries(node.files || {})) {
        const full = prefix + '/' + name;
        if (value.files) walk(value, full);
        else entries.push({ path: full, size: value.size, offset: value.offset });
      }
    };
    walk(header, '');

    const texts = [];
    for (const entry of entries) {
      if (!/\/dsh-client-ui-[^/]+\/lib\/client\.js$/.test(entry.path)) continue;
      const buf = Buffer.alloc(entry.size);
      readSync(fd, buf, 0, entry.size, dataOffset + Number(entry.offset));
      texts.push(buf.toString('utf8'));
    }
    return texts;
  } finally {
    closeSync(fd);
  }
}

const desktopAsarCandidates = [
  process.env.DSH_APP_ASAR,
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar',
].filter((candidate) => typeof candidate === 'string' && candidate !== '');
let desktopChecked = false;
for (const asarPath of desktopAsarCandidates) {
  if (!existsSync(asarPath)) continue;
  for (const source of readAsarBundles(asarPath)) {
    for (const match of source.matchAll(/\.([A-Za-z0-9-]{1,8})_[A-Za-z][a-zA-Z0-9]*/g)) {
      if (isHashPrefix(match[1])) hostHashes.add(match[1]);
    }
  }
  desktopChecked = true;
  break;
}

console.log('dsh ' + hostVersion + ' @ ' + hostRoot + ' (' + hostHashes.size + ' hash prefix(es)'
  + (desktopChecked ? ', Web + 桌面两套构建' : ', 仅 Web 版构建') + ')');

const pluginDirs = targets.length > 0
  ? targets.map((target) => resolve(REPO_ROOT, target))
  : readdirSync(join(REPO_ROOT, 'plugins'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(REPO_ROOT, 'plugins', entry.name))
    .sort();

let checked = 0;
let failures = 0;
for (const pluginDir of pluginDirs) {
  const manifestPath = join(pluginDir, 'package.json');
  if (!existsSync(manifestPath)) {
    console.log('FAIL no package.json under ' + pluginDir);
    failures += 1;
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const label = manifest.name + '@' + manifest.version;
  const clientPath = join(pluginDir, 'lib', 'client.js');
  checked += 1;
  if (!existsSync(clientPath)) {
    console.log('PASS ' + label + ' (no client half)');
    continue;
  }
  // 除 lib/client.js 外还要扫 lib/styles/*.css：主题这类插件的类名全在 CSS 里，
  // 只扫 client.js 会把它们判成 0 个前缀、永远 PASS。
  const styleDir = join(pluginDir, 'lib', 'styles');
  const sources = [readFileSync(clientPath, 'utf8')];
  if (existsSync(styleDir)) {
    for (const name of readdirSync(styleDir)) {
      if (name.endsWith('.css')) sources.push(readFileSync(join(styleDir, name), 'utf8'));
    }
  }
  const used = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/\.([A-Za-z0-9-]{1,8})_[A-Za-z][a-zA-Z0-9]*/g)) {
      if (isHashPrefix(match[1])) used.add(match[1]);
    }
  }
  const dead = [...used].filter((hash) => !hostHashes.has(hash)).sort();
  if (dead.length === 0) {
    console.log('PASS ' + label + ' (' + used.size + ' hash prefix(es) all present in this host)');
    continue;
  }
  failures += 1;
  console.log('FAIL ' + label + ' :: dead hash prefix(es) ' + dead.join(', ')
    + ' — no host bundle defines them, so those rules silently match nothing.');
}

console.log('');
if (failures === 0) {
  console.log('HASHES OK (' + checked + ' plugin(s) vs dsh ' + hostVersion + ')');
  process.exit(0);
}
console.log('HASHES FAILED: ' + failures + ' of ' + checked + ' plugin(s) style against a hash this host does not ship;'
  + ' switch to a stable data-* attribute, or add the current prefix next to the old one.');
process.exit(1);
