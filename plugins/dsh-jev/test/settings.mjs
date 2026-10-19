/**
 * 设置文件读写层（lib/settings.js）测试。
 *
 * 设置文件是前端「保存设置」唯一落盘的位置，行为必须明确：
 *   - 默认写入 ~/.dsh/jev/settings.json；
 *   - 默认路径下会合并早期版本写入的 ~/.config/typesafe/settings.json（只读兼容）；
 *   - 显式指定 settingsFile 时只读那一个文件，绝不旁落到真实用户配置；
 *   - 写文件是合并写入、权限 0600（里面可能存 API Key）；
 *   - 损坏的 JSON 被当成"没配过"，而不是抛异常。
 *
 * 通过临时 HOME 隔离，不碰真实用户目录。
 *
 * Run: node test/settings.mjs
 */
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'dsh-jev-settings-'));
// settings.js 在模块加载时用 homedir() 计算默认路径，必须在动态 import 前改家目录。
// Windows 上 homedir() 读的是 USERPROFILE 而不是 HOME，两个都要设，否则测试会
// 去读写真实的 ~/.dsh/jev/settings.json。
process.env.HOME = workDir;
process.env.USERPROFILE = workDir;

const settings = await import('../lib/settings.js');
const {
  DEFAULT_SETTINGS_PATH,
  LEGACY_SETTINGS_PATH,
  resolveSettingsPath,
  readSettingsFile,
  loadUserSettings,
  pickConfig,
  writeSettingsFile,
  describeConfigSource,
} = settings;

check('default settings path lives under the new location', DEFAULT_SETTINGS_PATH === join(workDir, '.dsh', 'jev', 'settings.json'), DEFAULT_SETTINGS_PATH);
check('legacy settings path is the old typesafe location', LEGACY_SETTINGS_PATH === join(workDir, '.config', 'typesafe', 'settings.json'), LEGACY_SETTINGS_PATH);

// ---------------------------------------------------------------------------
// path expansion
// ---------------------------------------------------------------------------
check('a bare path resolves to an absolute path', resolveSettingsPath('./custom.json') === join(process.cwd(), 'custom.json'), resolveSettingsPath('./custom.json'));
check('~/ is expanded to the home directory', resolveSettingsPath('~/x/settings.json') === join(workDir, 'x', 'settings.json'), resolveSettingsPath('~/x/settings.json'));
check('an empty config value means the default path', resolveSettingsPath(undefined) === DEFAULT_SETTINGS_PATH, resolveSettingsPath(undefined));

// ---------------------------------------------------------------------------
// missing / corrupt files are never fatal
// ---------------------------------------------------------------------------
check('a missing file reads as null', readSettingsFile(DEFAULT_SETTINGS_PATH) === null);
const corruptPath = join(workDir, 'corrupt.json');
await writeFile(corruptPath, '{not json', 'utf8');
check('a corrupt JSON file reads as null', readSettingsFile(corruptPath) === null);
check('a corrupt file is reported as inferred', describeConfigSource(loadUserSettings(corruptPath)) === 'inferred (no settings file yet)', describeConfigSource(loadUserSettings(corruptPath)));

// ---------------------------------------------------------------------------
// merge-write + permissions
// ---------------------------------------------------------------------------
const target = join(workDir, 'nested', 'settings.json');
writeSettingsFile(target, { source: 'provider', provider: 'ai-proxy' }, { source: 'user-set' });
writeSettingsFile(target, { model: 'jev-latest' });
const onDisk = JSON.parse(await readFile(target, 'utf8'));
check('merge-write keeps earlier fields', onDisk.source === 'provider' && onDisk.provider === 'ai-proxy', JSON.stringify(onDisk));
check('merge-write adds the new field', onDisk.model === 'jev-latest', JSON.stringify(onDisk));
check('merge-write stores the source marker', onDisk._source === 'user-set', JSON.stringify(onDisk));
const mode = (await stat(target)).mode & 0o777;
// Windows 的 NTFS 不支持 POSIX 的 0600，chmod 只能表达只读位，实际模式恒为 666。
// 权限收紧在 POSIX 上才有意义，因此只在支持它的平台上断言。
if (process.platform === 'win32') {
  check('the settings file mode is left to the filesystem on Windows', mode !== 0, mode.toString(8));
} else {
  check('the settings file is written with 0600 permissions', mode === 0o600, mode.toString(8));
}

const explicit = loadUserSettings(target);
check('explicit paths never read the legacy file', explicit.legacyPath === null, String(explicit.legacyPath));
check('explicit paths report the file values', explicit.values.model === 'jev-latest' && explicit.hasFile === true, JSON.stringify(explicit.values));

// ---------------------------------------------------------------------------
// default path merges the legacy file
// ---------------------------------------------------------------------------
await mkdir(join(workDir, '.config', 'typesafe'), { recursive: true });
await writeFile(LEGACY_SETTINGS_PATH, JSON.stringify({ baseURL: 'http://legacy.local:8000', endpoint: '/v1/decisions', proxy: '' }) + '\n', 'utf8');
await mkdir(join(workDir, '.dsh', 'jev'), { recursive: true });
await writeFile(DEFAULT_SETTINGS_PATH, JSON.stringify({ model: 'jev-latest', endpoint: '/v1/systemone' }) + '\n', 'utf8');

const merged = loadUserSettings(undefined);
check('the new file overrides the legacy one', merged.values.endpoint === '/v1/systemone', JSON.stringify(merged.values));
check('legacy-only fields survive the merge', merged.values.baseURL === 'http://legacy.local:8000', JSON.stringify(merged.values));
check('the merge is reported', merged.legacyPath === LEGACY_SETTINGS_PATH, String(merged.legacyPath));

// ---------------------------------------------------------------------------
// pickConfig
// ---------------------------------------------------------------------------
const picked = pickConfig({ source: 'provider', provider: 'ai-proxy', baseURL: 'http://x', model: 'jev-latest', apiKey: 'secret', unknown: 1 });
check('pickConfig keeps known fields', picked.provider === 'ai-proxy' && picked.model === 'jev-latest', JSON.stringify(picked));
check('pickConfig drops unknown fields', picked.unknown === undefined, JSON.stringify(picked));
check('pickConfig hides the apiKey by default', picked.apiKey === undefined, JSON.stringify(picked));
check('pickConfig includes the apiKey on request', pickConfig({ apiKey: 'secret' }, { includeSecrets: true }).apiKey === 'secret');

await rm(workDir, { recursive: true, force: true });

console.log('');
console.log(failures === 0 ? 'SETTINGS OK' : 'SETTINGS FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
