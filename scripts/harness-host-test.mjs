#!/usr/bin/env node
/**
 * 在隔离环境里跑某个插件的宿主入口测试。
 *
 * 为什么需要它：插件 `lib/index.js` 会 `import '@deepseek-ai/schemastery'` 这类
 * 宿主包。在仓库开发态下这些包只在「装过依赖的插件目录」或「运行中的 profile」
 * 里可解析；直接 `node --test` 会因模块解析失败而报错，而不是测出真问题。
 *
 * 本脚本的做法（不碰任何真实 profile、不执行 dsh 命令、不装任何东西）：
 *
 *   1. 建一个临时目录，里面放 `node_modules/@deepseek-ai/*` 的**符号链接**，
 *      指向本机 dsh 安装里真实的宿主包；
 *   2. 把插件目录**物理复制**过去（不能软链插件本体：Node 会按 realpath
 *      解析，软链会让 import 落回源码目录，于是又找不到宿主包）；
 *   3. 在临时目录里跑 `node --test test/host.test.mjs`。
 *
 * 用法：
 *   node scripts/harness-host-test.mjs plugins/dsh-im-bot
 *   node scripts/harness-host-test.mjs plugins/dsh-im-bot test/host.test.mjs
 *
 * 找不到 dsh 时打印 SKIP 并退出 0，方便串进 `npm test`。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');

/** 插件源码会 import 的宿主包（新增 import 时同步这里）。 */
const HOST_PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-host-webserver',
];

const pluginArg = process.argv[2];
if (pluginArg === undefined) {
  console.error('usage: node scripts/harness-host-test.mjs <plugin-dir> [test-file]');
  process.exit(2);
}
const pluginDir = resolve(REPO_ROOT, pluginArg);
const testFile = process.argv[3] ?? 'test/host.test.mjs';
if (!existsSync(join(pluginDir, testFile))) {
  console.log('SKIP no ' + testFile + ' in ' + pluginArg);
  process.exit(0);
}

// 定位本机 dsh 安装：优先 PATH 上的 dsh，退回到 npm 全局根。
let hostRoot;
const which = spawnSync('which', ['dsh'], { encoding: 'utf8' });
if (which.status === 0 && which.stdout.trim() !== '') {
  hostRoot = resolve(dirname(realpathSync(which.stdout.trim())), '..');
} else {
  const npmRoot = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' });
  if (npmRoot.status === 0) {
    const candidate = join(npmRoot.stdout.trim(), '@deepseek-ai', 'dsh');
    if (existsSync(candidate)) hostRoot = candidate;
  }
}
if (hostRoot === undefined) {
  console.log('SKIP no dsh install found (neither PATH nor npm -g)');
  process.exit(0);
}
const hostScope = join(hostRoot, 'node_modules', '@deepseek-ai');
if (!existsSync(hostScope)) {
  console.log('SKIP no @deepseek-ai scope next to ' + hostRoot);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'dsh-host-test-'));
try {
  // 1. 宿主包符号链接
  const scopeDir = join(work, 'node_modules', '@deepseek-ai');
  mkdirSync(scopeDir, { recursive: true });
  let linked = 0;
  for (const pkg of HOST_PACKAGES) {
    const shortName = pkg.slice('@deepseek-ai/'.length);
    const target = join(hostScope, shortName);
    if (!existsSync(target)) continue;
    symlinkSync(target, join(scopeDir, shortName), 'dir');
    linked += 1;
  }
  if (linked === 0) {
    console.log('SKIP none of the required host packages exist under ' + hostScope);
    process.exit(0);
  }

  // 2. 插件物理复制（跳过 node_modules 与历史 tgz）
  const dest = join(work, 'plugin');
  cpSync(pluginDir, dest, {
    recursive: true,
    filter: (source) => {
      const base = source.slice(pluginDir.length);
      if (base.includes('node_modules')) return false;
      if (base.endsWith('.tgz')) return false;
      return true;
    },
  });
  // 插件以 @weniatall/<name> 形式被 import 时也要能解析；测试里用的是相对路径，
  // 这里顺手建一个别名，方便将来改成按包名导入。
  const aliasDir = join(work, 'node_modules', '@weniatall');
  mkdirSync(aliasDir, { recursive: true });
  symlinkSync(dest, join(aliasDir, 'plugin'), 'dir');

  console.log(`宿主包 ${linked} 个 ← ${hostScope}`);
  console.log(`插件副本 → ${dest}`);

  const run = spawnSync('node', ['--test', testFile], {
    cwd: dest,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  process.exit(run.status ?? 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
