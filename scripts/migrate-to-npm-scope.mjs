#!/usr/bin/env node
/**
 * 把仓库内的插件迁移到 npm scope 发布形态。
 *
 * 背景：12 个插件里有 9 个的无 scope 包名（dsh-terminal、dsh-file-viewer …）
 * 已被第三方在 npm 上占用且不可转让，因此统一迁移到 `@weniatall/` scope。
 * scope 包默认是 restricted，必须显式声明 `publishConfig.access = "public"`，
 * 否则 `npm publish` 会要求付费私有包配额。
 *
 * 本脚本只做三件幂等的事：
 *   1. package.json 的 name 加上 scope 前缀；
 *   2. 补齐 publishConfig / repository / homepage / bugs / engines；
 *   3. 删除 `private: true`（否则 npm publish 直接拒绝）。
 *
 * 不做的事：不改 cordis.patch.yml（由另一个脚本处理），不改依赖版本，
 * 不动版本号。
 *
 * 用法：
 *   node scripts/migrate-to-npm-scope.mjs --dry-run   # 只打印将要发生的改动
 *   node scripts/migrate-to-npm-scope.mjs             # 实际写入
 *   node scripts/migrate-to-npm-scope.mjs --plugin dsh-mobile-adapter
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

const SCOPE = '@weniatall';
const REPO_ORIGIN = 'veildawn/dsh-plugins';
const REPO_URL = `git+https://github.com/${REPO_ORIGIN}.git`;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const onlyIndex = argv.indexOf('--plugin');
const only = onlyIndex === -1 ? undefined : argv[onlyIndex + 1];

/** 已发布过、因此必须保持 `engines` 现状的插件无需特殊处理；统一用 Node 20.3。 */
const MIN_NODE = '>=20.3';

function scopedName(name) {
  return name.startsWith('@') ? name : `${SCOPE}/${name}`;
}

function planFor(dirName, pkg) {
  const changes = [];
  const next = { ...pkg };

  const target = scopedName(pkg.name);
  if (target !== pkg.name) {
    next.name = target;
    changes.push(`name: ${pkg.name} -> ${target}`);
  }

  if (pkg.private === true) {
    delete next.private;
    changes.push('删除 private: true（npm publish 会拒绝私有包）');
  }

  // scope 包默认 restricted，必须显式 public
  const publishConfig = { ...(pkg.publishConfig ?? {}) };
  if (publishConfig.access !== 'public') {
    publishConfig.access = 'public';
    changes.push('publishConfig.access: public');
  }
  if (publishConfig.registry !== 'https://registry.npmjs.org/') {
    publishConfig.registry = 'https://registry.npmjs.org/';
    changes.push('publishConfig.registry: https://registry.npmjs.org/');
  }
  next.publishConfig = publishConfig;

  const repository = {
    type: 'git',
    url: REPO_URL,
    directory: `plugins/${dirName}`,
  };
  if (JSON.stringify(pkg.repository) !== JSON.stringify(repository)) {
    next.repository = repository;
    changes.push(`repository -> ${REPO_ORIGIN} / plugins/${dirName}`);
  }

  const homepage = `https://github.com/${REPO_ORIGIN}/tree/main/plugins/${dirName}#readme`;
  if (pkg.homepage !== homepage) {
    next.homepage = homepage;
    changes.push('homepage 补齐');
  }

  const bugs = { url: `https://github.com/${REPO_ORIGIN}/issues` };
  if (JSON.stringify(pkg.bugs) !== JSON.stringify(bugs)) {
    next.bugs = bugs;
    changes.push('bugs 补齐');
  }

  if (pkg.engines?.node !== MIN_NODE) {
    next.engines = { ...(pkg.engines ?? {}), node: MIN_NODE };
    changes.push(`engines.node: ${MIN_NODE}`);
  }

  return { next, changes };
}

const dirs = readdirSync(PLUGINS_DIR)
  .filter((entry) => statSync(join(PLUGINS_DIR, entry)).isDirectory())
  .filter((entry) => (only === undefined ? true : entry === only))
  .sort();

if (dirs.length === 0) {
  console.error(only === undefined ? '没有找到任何插件目录' : `没有找到插件目录: ${only}`);
  process.exit(1);
}

let touched = 0;
for (const dirName of dirs) {
  const manifestPath = join(PLUGINS_DIR, dirName, 'package.json');
  const raw = readFileSync(manifestPath, 'utf8');
  const pkg = JSON.parse(raw);
  const { next, changes } = planFor(dirName, pkg);

  if (changes.length === 0) {
    console.log(`= ${dirName} 已就绪，无改动`);
    continue;
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}${dirName}`);
  for (const change of changes) console.log(`    ${change}`);

  if (!dryRun) {
    writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }
  touched += 1;
}

console.log(
  `\n${dryRun ? '将改动' : '已改动'} ${touched} 个 package.json` +
    (dryRun ? '（未写入，去掉 --dry-run 生效）' : ''),
);
