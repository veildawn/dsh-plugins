#!/usr/bin/env node
/**
 * 把客户端 bundle 里 __ModuleLoader__ 注册用的 id 迁移到 npm scope 名。
 *
 * 为什么必须改：宿主 @deepseek-ai/dsh-client-modules 的加载链路是
 *   locatePkgJson(loaderName) -> packageName -> 浏览器模块 id
 * 其中 loaderName 来自 cordis.patch.yml 的 name，packageName 取自该包
 * package.json 的 name。三者必须完全一致，否则浏览器端报：
 *   bundle ... loaded without registering "<id>" via __ModuleLoader__.load
 * 表现为插件前端整体不渲染（宿主日志里才看得到原因）。
 *
 * 只改「window.__ModuleLoader__.load({` 之后出现的第一个 id 字段。
 * 同一个文件里还有别的同名 id（业务数据、卡片数据），那些绝不能动 ——
 * 例如 dsh-plugin-manager 的 client.js 里就有一份插件市场条目数据带
 * id: "dsh-plugin-manager"。
 *
 * 用法：
 *   node scripts/migrate-client-bundle-id.mjs --dry-run
 *   node scripts/migrate-client-bundle-id.mjs
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

for (const dirName of dirs) {
  const clientPath = join(PLUGINS_DIR, dirName, 'lib', 'client.js');
  if (!existsSync(clientPath)) {
    console.log(`跳过 ${dirName}（无 lib/client.js）`);
    continue;
  }

  const source = readFileSync(clientPath, 'utf8');

  // 定位 __ModuleLoader__.load({ ... }) 的注册点。
  const loaderIndex = source.indexOf('__ModuleLoader__.load(');
  if (loaderIndex === -1) {
    console.log(`跳过 ${dirName}（client.js 里没有 __ModuleLoader__.load 注册点）`);
    continue;
  }

  // 在注册点之后的有限窗口内找第一个 id 字段，避免匹配到文件后段的业务数据。
  // 窗口取 2000 字符：注册对象的头部（id/factory）一定在这个范围内。
  const windowEnd = Math.min(source.length, loaderIndex + 2000);
  const head = source.slice(loaderIndex, windowEnd);

  const idPattern = /(\bid:\s*)(['"])([^'"]+)\2/;
  const match = idPattern.exec(head);
  if (match === null) {
    console.log(`跳过 ${dirName}（注册点后未找到 id 字段）`);
    continue;
  }

  const [, prefix, quote, currentId] = match;
  if (currentId.startsWith('@')) {
    console.log(`= ${dirName} 注册 id 已是 scope 形态，无需改动`);
    continue;
  }

  const scopedId = `${SCOPE}/${currentId}`;
  const absoluteIndex = loaderIndex + match.index;
  const replacement = `${prefix}${quote}${scopedId}${quote}`;
  const next = source.slice(0, absoluteIndex) + replacement + source.slice(absoluteIndex + match[0].length);

  console.log(`\n${dryRun ? '[dry-run] ' : ''}${dirName}/lib/client.js`);
  console.log(`    注册 id: ${currentId} -> ${scopedId}`);
  console.log(`    文件偏移 ${absoluteIndex}（__ModuleLoader__ 注册点在 ${loaderIndex}）`);

  if (!dryRun) {
    writeFileSync(clientPath, next, 'utf8');
  }
  touched += 1;
}

console.log(
  `\n${dryRun ? '将改动' : '已改动'} ${touched} 个客户端 bundle` + (dryRun ? '（未写入）' : ''),
);
