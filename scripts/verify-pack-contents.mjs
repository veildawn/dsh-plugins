#!/usr/bin/env node
/**
 * 发布前校验：每个插件 `npm pack` 出来的内容必须恰好是运行期需要的文件。
 *
 * 为什么需要这道闸门：`files` 白名单一旦写漏（比如新增了 lib/xxx.js 却忘了
 * 加进 files），包在本地测试完全正常 —— 因为测试直接读源码目录 —— 但用户
 * 装到 profile 后会在 import 时报 "Cannot find module"。反过来，白名单写宽
 * （比如 "lib"）会把测试、历史 tgz 甚至本地调试产物一起发出去。
 *
 * 本脚本对每个插件执行 `npm pack --dry-run --json`，断言：
 *   1. 不含 test/、node_modules/、*.tgz、src/、.git*；
 *   2. package.json、cordis.patch.yml、README.md 必须存在；
 *   3. `main` 与 `exports` 指向的每个文件都必须在产物里；
 *   4. 产物总大小低于上限（防止误打包大文件）。
 *
 * 用法：
 *   node scripts/verify-pack-contents.mjs
 *   node scripts/verify-pack-contents.mjs --plugin dsh-terminal
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

/** 单包解压后体积上限：超过通常意味着误打包了二进制或 node_modules。 */
const MAX_UNPACKED_BYTES = 8 * 1024 * 1024;

/** npm 可执行名：Windows 上是 `npm.cmd`。 */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** 任何情况下都不该出现在发布产物里的路径。 */
const FORBIDDEN = [
  { test: (p) => p.startsWith('test/'), why: '测试目录' },
  { test: (p) => p.includes('node_modules/'), why: '依赖目录' },
  { test: (p) => p.endsWith('.tgz') || p.endsWith('.tar.gz'), why: '历史打包产物' },
  { test: (p) => p.startsWith('src/'), why: '源码目录（应发布构建产物 lib/）' },
  { test: (p) => p.startsWith('.git'), why: '版本控制文件' },
  { test: (p) => p.endsWith('.log'), why: '日志文件' },
];

const argv = process.argv.slice(2);
const onlyIndex = argv.indexOf('--plugin');
const only = onlyIndex === -1 ? undefined : argv[onlyIndex + 1];

const dirs = readdirSync(PLUGINS_DIR)
  .filter((entry) => statSync(join(PLUGINS_DIR, entry)).isDirectory())
  .filter((entry) => (only === undefined ? true : entry === only))
  .sort();

if (dirs.length === 0) {
  console.error(only === undefined ? '没有找到任何插件目录' : `没有找到插件目录: ${only}`);
  process.exit(1);
}

let failures = 0;

for (const dirName of dirs) {
  const pluginDir = join(PLUGINS_DIR, dirName);
  const manifestPath = join(pluginDir, 'package.json');
  if (!existsSync(manifestPath)) {
    console.error(`FAIL ${dirName}: 缺少 package.json`);
    failures += 1;
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  let report;
  try {
    // Windows 上 `npm` 是 `npm.cmd` 包装脚本，execFileSync 不会经过 shell，
    // 直接 spawn('npm') 会 ENOENT。用 shell 让它按平台的 PATHEXT 解析，
    // Linux/macOS 行为不变。
    const stdout = execFileSync(NPM, ['pack', '--dry-run', '--json'], {
      cwd: pluginDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    report = JSON.parse(stdout)[0];
  } catch (error) {
    console.error(`FAIL ${dirName}: npm pack --dry-run 失败: ${error.message}`);
    failures += 1;
    continue;
  }

  const problems = [];
  const paths = report.files.map((file) => file.path);

  // 1. 禁止出现的路径
  for (const path of paths) {
    for (const rule of FORBIDDEN) {
      if (rule.test(path)) problems.push(`包含 ${rule.why}: ${path}`);
    }
  }

  // 2. 必需文件
  for (const required of ['package.json', 'cordis.patch.yml', 'README.md']) {
    if (!paths.includes(required)) problems.push(`缺少必需文件: ${required}`);
  }

  // 3. main / exports 指向的文件必须真的被打包
  const declared = new Set()
  if (typeof manifest.main === 'string') declared.add(manifest.main)
  for (const value of Object.values(manifest.exports ?? {})) {
    if (typeof value === 'string') declared.add(value)
    else if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) {
        if (typeof nested === 'string') declared.add(nested)
      }
    }
  }
  for (const entry of declared) {
    const normalized = entry.replace(/^\.\//, '')
    if (!paths.includes(normalized)) {
      problems.push(`main/exports 指向的文件未被打包: ${entry}`)
    }
  }

  // 4. 体积上限
  if (report.unpackedSize > MAX_UNPACKED_BYTES) {
    const mb = (report.unpackedSize / 1024 / 1024).toFixed(2)
    problems.push(`解压体积 ${mb} MB 超过上限 ${MAX_UNPACKED_BYTES / 1024 / 1024} MB`)
  }

  if (problems.length === 0) {
    console.log(
      `PASS ${dirName.padEnd(24)} ${String(report.entryCount).padStart(3)} 个文件  ` +
        `${(report.size / 1024).toFixed(1)} KB（解压 ${(report.unpackedSize / 1024).toFixed(0)} KB）`,
    )
  } else {
    failures += 1
    console.error(`FAIL ${dirName}`)
    for (const problem of problems) console.error(`       ${problem}`)
  }
}

console.log()
if (failures === 0) {
  console.log(`全部 ${dirs.length} 个插件的发布内容校验通过`)
} else {
  console.error(`${failures} 个插件未通过发布内容校验`)
  process.exit(1)
}
