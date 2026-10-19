#!/usr/bin/env node
/**
 * 批量发布 npm 占位包（placeholder / stub）。
 *
 * 为什么需要占位：
 *   npm Trusted Publishing 只能给**已存在**的包配置。为了让 12 个插件包
 *   都能在 npm 网页上一次性配置好 OIDC 信任关系，先各发一个 0.0.0-stage
 *   的空壳占住包名，之后再走 CI 发正式版。
 *
 * 占位包刻意做得极小（package.json + README），且带 `stub: true` 标记，
 * 避免有人误装。它不会成为 latest 之外的默认版本：正式版发布后
 * `npm publish` 会把 latest 指向正式版。
 *
 * 用法：
 *   node scripts/publish-placeholders.mjs --dry-run        # 只打印计划
 *   node scripts/publish-placeholders.mjs                  # 真正发布（需要 OTP）
 *   node scripts/publish-placeholders.mjs --plugin dsh-jev # 只发一个
 *   node scripts/publish-placeholders.mjs --otp 123456     # 直接带 OTP
 *
 * 注意：npm 账号开了 2FA（auth-and-writes），每次 publish 都要 OTP。
 * 批量为每个包单独执行 npm publish；OTP 有效期内可以连续发多个，
 * 一旦超时，脚本会停下并告诉你从哪个包继续（--start-at）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

const STAGE_VERSION = '0.0.0-stage';

const README = `# Temporary Holding Version

This version is a temporary placeholder for this package. An operational
version to replace this will be published from the project's CI pipeline.

Do not install this version. See https://github.com/veildawn/dsh-plugins
for the real plugin documentation.
`;

function parseArgs(argv) {
  const options = { dryRun: false, only: undefined, otp: undefined, startAt: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--plugin') options.only = argv[++index];
    else if (arg === '--otp') options.otp = argv[++index];
    else if (arg === '--start-at') options.startAt = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/publish-placeholders.mjs [--dry-run] [--plugin NAME] [--otp CODE] [--start-at NAME]');
      process.exit(0);
    } else {
      console.error(`未知参数: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

/** 该包名是否已在 registry 上存在。 */
function packageExists(name) {
  try {
    execFileSync('npm', ['view', name, 'name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function publishStub(packageName, description, homepage, repository, options) {
  const stagingDir = mkdtempSync(join(tmpdir(), 'npm-stub-'));
  try {
    const manifest = {
      name: packageName,
      version: STAGE_VERSION,
      stub: true,
      description: `Temporary package placeholder for ${packageName}`,
      license: 'MIT',
      homepage,
      repository,
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    };
    writeFileSync(join(stagingDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    writeFileSync(join(stagingDir, 'README.md'), README, 'utf8');

    const args = ['publish', '--access', 'public', '--registry', 'https://registry.npmjs.org/'];
    if (options.otp !== undefined) args.push('--otp', options.otp);

    const output = execFileSync('npm', args, {
      cwd: stagingDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: output.trim() };
  } catch (error) {
    const stderr = String(error.stderr ?? '');
    const stdout = String(error.stdout ?? '');
    const message = (stderr || stdout || error.message).trim();
    return { ok: false, message };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv.slice(2));

const dirs = readdirSync(PLUGINS_DIR)
  .filter((entry) => statSync(join(PLUGINS_DIR, entry)).isDirectory())
  .filter((entry) => (options.only === undefined ? true : entry === options.only))
  .sort();

if (dirs.length === 0) {
  console.error(options.only === undefined ? '没有找到任何插件目录' : `没有找到插件目录: ${options.only}`);
  process.exit(1);
}

// --start-at：从指定插件开始（OTP 超时后继续用）
let startIndex = 0;
if (options.startAt !== undefined) {
  const found = dirs.indexOf(options.startAt);
  if (found === -1) {
    console.error(`--start-at 指定的插件不在待发列表里: ${options.startAt}`);
    process.exit(2);
  }
  startIndex = found;
}

console.log(`准备发布 ${dirs.length - startIndex} 个占位包（版本 ${STAGE_VERSION}）`);
console.log(`registry: https://registry.npmjs.org/`);
console.log(`2FA: 已开启，每个包都需要 OTP${options.otp === undefined ? '（脚本会提示输入）' : '（已通过 --otp 提供）'}`);
console.log('');

const results = [];

for (let index = startIndex; index < dirs.length; index += 1) {
  const dirName = dirs[index];
  const manifestPath = join(PLUGINS_DIR, dirName, 'package.json');
  if (!existsSync(manifestPath)) {
    results.push({ dirName, status: 'skip', detail: '缺少 package.json' });
    continue;
  }

  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packageName = manifest.name;

  console.log(`[${index + 1}/${dirs.length}] ${packageName}`);

  if (packageExists(packageName)) {
    console.log('        已存在，跳过');
    results.push({ dirName, packageName, status: 'exists' });
    continue;
  }

  if (options.dryRun) {
    console.log(`        [dry-run] 将发布 ${STAGE_VERSION}`);
    results.push({ dirName, packageName, status: 'dry-run' });
    continue;
  }

  const result = publishStub(
    packageName,
    manifest.description,
    manifest.homepage,
    manifest.repository,
    options,
  );

  if (result.ok) {
    console.log(`        发布成功: ${packageName}@${STAGE_VERSION}`);
    results.push({ dirName, packageName, status: 'published' });
  } else {
    // OTP 过期是最常见的失败：立刻停下，避免后面全部失败。
    const isOtp = /otp|one-time|EOTP/i.test(result.message);
    console.error(`        失败${isOtp ? '（OTP 无效或已过期）' : ''}: ${result.message.split('\n')[0]}`);
    results.push({ dirName, packageName, status: 'failed', detail: result.message });
    if (isOtp) {
      console.error('');
      console.error(`OTP 已失效，从下一个包继续：`);
      console.error(`  node scripts/publish-placeholders.mjs --start-at ${dirs[index + 1] ?? '<最后一个>'} --otp <新验证码>`);
      break;
    }
  }
}

console.log('');
console.log('=== 汇总 ===');
const counts = results.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});
for (const [status, count] of Object.entries(counts)) console.log(`  ${status}: ${count}`);

const published = results.filter((item) => item.status === 'published');
if (published.length > 0) {
  console.log('');
  console.log('接下来去 npm 网页给这些包配置 Trusted Publisher：');
  for (const item of published) {
    console.log(`  https://www.npmjs.com/package/${item.packageName}/access`);
  }
}

const failed = results.filter((item) => item.status === 'failed');
if (failed.length > 0) process.exitCode = 1;
