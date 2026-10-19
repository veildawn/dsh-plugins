#!/usr/bin/env node
/**
 * 把 cordis.patch.yml 里指向本插件包名的 `name:` 字段迁移到 npm scope。
 *
 * 为什么必须改：`name` 是 cordis loader 的模块标识符（不是注释）。
 * loader 的实现是：
 *   - 以 `.` 开头 → 按 patch 文件所在目录解析相对路径；
 *   - 否则       → 直接 `import(name)`，走标准 ESM 裸模块解析。
 * 所以 `@scope/name` 与无 scope 名走的是同一条分支，改成 scope 名不会
 * 引入新的解析问题。反过来，如果包名加了 scope 而 patch 里还留着旧的无
 * scope 名，`import()` 会去 node_modules 找一个不存在的包，插件静默加载失败。
 *
 * 例外：`name: './lib/index.js'` 这类相对路径（dsh-jev / dsh-image-gen）
 * 是相对 patch 文件解析的，与包名无关，必须原样保留 —— 本脚本自动跳过。
 *
 * 用法：
 *   node scripts/migrate-patches-to-npm-scope.mjs --dry-run
 *   node scripts/migrate-patches-to-npm-scope.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

const SCOPE = '@weniatall';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const onlyIndex = argv.indexOf('--plugin');
const only = onlyIndex === -1 ? undefined : argv[onlyIndex + 1];

const dirs = readdirSync(PLUGINS_DIR)
  .filter((entry) => statSync(join(PLUGINS_DIR, entry)).isDirectory())
  .filter((entry) => (only === undefined ? true : entry === only))
  .sort();

let touched = 0;
const skipped = [];

for (const dirName of dirs) {
  const patchPath = join(PLUGINS_DIR, dirName, 'cordis.patch.yml');
  if (!existsSync(patchPath)) {
    skipped.push(`${dirName}（无 cordis.patch.yml）`);
    continue;
  }

  const original = readFileSync(patchPath, 'utf8');
  const lines = original.split('\n');
  const rewrites = [];

  const next = lines.map((line, index) => {
    // 只匹配真正的 YAML 键，排除被注释掉的行。
    // 形如：      name: dsh-terminal
    const match = /^(\s*)name:\s*(\S+)\s*$/.exec(line);
    if (match === null) return line;

    const [, indent, rawValue] = match;

    // YAML 标量可能带单/双引号（如 'name: './lib/index.js''），判断前先剥掉。
    const value = rawValue.replace(/^['"]/, '').replace(/['"]$/, '');

    // 相对路径 / 绝对路径：由 loader 按 patch 文件位置解析，与包名无关。
    if (value.startsWith('.') || value.startsWith('/')) {
      return line;
    }

    // 已经是 scope 形态（理论上不会出现，保持幂等）。
    if (value.startsWith('@')) return line;

    const scoped = `${SCOPE}/${value}`;
    rewrites.push(`${index + 1}: ${value} -> ${scoped}`);
    // `@` 是 YAML 保留字符：裸写的标量会让 js-yaml 报
    // "bad indentation of a mapping entry"，宿主启动时直接解析失败。
    // 必须加引号写成字符串。
    return `${indent}name: '${scoped}'`;
  });

  if (rewrites.length === 0) {
    console.log(`= ${dirName} 无需改动（name 为相对路径或已是 scope）`);
    continue;
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}${dirName}/cordis.patch.yml`);
  for (const rewrite of rewrites) console.log(`    行 ${rewrite}`);

  if (!dryRun) {
    writeFileSync(patchPath, next.join('\n'), 'utf8');
  }
  touched += 1;
}

for (const entry of skipped) console.log(`跳过 ${entry}`);
console.log(
  `\n${dryRun ? '将改动' : '已改动'} ${touched} 个 cordis.patch.yml` +
    (dryRun ? '（未写入）' : ''),
);
