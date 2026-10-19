/**
 * 设置文件层（lib/settings.js）测试。
 *
 * 覆盖前端「保存设置」落盘与读回的完整往返：路径展开、坏文件容错、
 * 字段白名单、来源模式校验、尺寸/画质校验、合并写入保留未知字段。
 *
 * 全程只写 mkdtemp 临时目录，不碰 ~/.dsh。
 *
 * Run: node test/settings.mjs
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DEFAULT_QUALITY,
  DEFAULT_SETTINGS_PATH,
  DEFAULT_SIZE,
  describeConfigSource,
  normalizeConfig,
  pickConfig,
  readSettingsFile,
  resolveSettingsPath,
  writeSettingsFile,
} from '../lib/settings.js';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

function expectThrow(label, fn, needle) {
  try {
    fn();
    check(label, false, 'expected an error, got success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, message.includes(needle), message);
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'dsh-image-settings-'));

// ---------------------------------------------------------------------------
// 1. path resolution
// ---------------------------------------------------------------------------
check('the default path lives under ~/.dsh/image-gen', DEFAULT_SETTINGS_PATH === join(homedir(), '.dsh', 'image-gen', 'settings.json'), DEFAULT_SETTINGS_PATH);
check('an empty value resolves to the default', resolveSettingsPath('') === DEFAULT_SETTINGS_PATH);
check('undefined resolves to the default', resolveSettingsPath(undefined) === DEFAULT_SETTINGS_PATH);
check('~ expands to the home directory', resolveSettingsPath('~/x/settings.json') === join(homedir(), 'x', 'settings.json'));
check('a relative path resolves against the cwd', resolveSettingsPath('cfg.json') === resolve(process.cwd(), 'cfg.json'));
// Windows 没有 POSIX 的 "/tmp" 绝对路径，path.resolve 会把它变成 "<当前盘>:\tmp\abc.json"，
// 因此按平台各取一个真正的绝对路径来断言「绝对路径原样保留」。
const absoluteSample = process.platform === 'win32' ? 'C:\\temp\\abc.json' : '/tmp/abc.json';
check('an absolute path is kept', resolveSettingsPath(absoluteSample) === absoluteSample, resolveSettingsPath(absoluteSample));
check('a temp path is kept', resolveSettingsPath(join(workDir, 's.json')) === join(workDir, 's.json'));

// ---------------------------------------------------------------------------
// 2. read / write round-trip
// ---------------------------------------------------------------------------
const filePath = join(workDir, 'nested', 'settings.json');
check('a missing file reads as null', readSettingsFile(filePath) === null);

writeSettingsFile(
  filePath,
  { source: 'provider', provider: 'ai-proxy', model: 'gemini-3.1-flash-image', size: '1024x1024', quality: 'high', proxy: '' },
  { source: 'user-set' },
);
const written = await readFile(filePath, 'utf8');
check('the file is written as pretty JSON with a trailing newline', written.endsWith('\n') && written.includes('\n  '), written.slice(0, 40));
const parsed = JSON.parse(written);
check('the source marker records that a user set it', parsed._source === 'user-set', parsed._source);
check('all fields land', parsed.provider === 'ai-proxy' && parsed.model === 'gemini-3.1-flash-image' && parsed.size === '1024x1024' && parsed.quality === 'high');
check('describeConfigSource reads the marker', describeConfigSource(filePath) === 'user-set', describeConfigSource(filePath));
check('a missing file is described as inferred', describeConfigSource(join(workDir, 'nope.json')) === 'inferred (no settings file yet)');

// ---------------------------------------------------------------------------
// 3. tolerance for broken files
// ---------------------------------------------------------------------------
const broken = join(workDir, 'broken.json');
await writeFile(broken, '{not json at all', 'utf8');
check('a corrupted file reads as null', readSettingsFile(broken) === null);
const arrayFile = join(workDir, 'array.json');
await writeFile(arrayFile, '[1,2,3]', 'utf8');
check('a JSON array reads as null', readSettingsFile(arrayFile) === null);
const markerless = join(workDir, 'markerless.json');
await writeFile(markerless, JSON.stringify({ provider: 'p', model: 'm' }), 'utf8');
check('a file without a marker is described as user-set', describeConfigSource(markerless) === 'user-set (settings file exists, no _source marker)', describeConfigSource(markerless));
check('a corrupted file is described as unreadable', describeConfigSource(broken).startsWith('inferred (the settings file is unreadable'), describeConfigSource(broken));
check('pickConfig tolerates null', Object.keys(pickConfig(null)).length === 0);

// ---------------------------------------------------------------------------
// 4. field whitelist
// ---------------------------------------------------------------------------
const picked = pickConfig({
  source: 'provider',
  provider: 'ai-proxy',
  baseURL: 'http://h/v1',
  model: 'm',
  size: '512x512',
  quality: 'low',
  proxy: 'http://127.0.0.1:7890',
  _source: 'user-set',
  junk: 'ignored',
  apiKey: 'sk-secret',
});
check('pickConfig keeps the known fields', picked.provider === 'ai-proxy' && picked.model === 'm' && picked.size === '512x512' && picked.quality === 'low');
check('pickConfig keeps the proxy', picked.proxy === 'http://127.0.0.1:7890');
check('pickConfig keeps baseURL for manual mode', picked.baseURL === 'http://h/v1');
check('pickConfig drops the source marker', picked._source === undefined);
check('pickConfig drops unknown keys', picked.junk === undefined);
check('pickConfig never carries an apiKey', picked.apiKey === undefined, JSON.stringify(Object.keys(picked)));
check('pickConfig tolerates null', Object.keys(pickConfig(null)).length === 0);
check('pickConfig ignores wrong-typed fields', pickConfig({ provider: 42, model: null, size: {} }).provider === undefined);

// ---------------------------------------------------------------------------
// 5. merge write keeps unknown fields
// ---------------------------------------------------------------------------
const mergePath = join(workDir, 'merge.json');
await writeFile(mergePath, JSON.stringify({ provider: 'p', note: 'keep me' }), 'utf8');
writeSettingsFile(mergePath, { model: 'm2' });
const merged = JSON.parse(await readFile(mergePath, 'utf8'));
check('merging preserves untouched fields', merged.provider === 'p' && merged.note === 'keep me');
check('merging applies the patch', merged.model === 'm2');
writeSettingsFile(mergePath, { size: '512x512' }, { source: 'auto' });
const merged2 = JSON.parse(await readFile(mergePath, 'utf8'));
check('a later source marker overwrites the earlier one', merged2._source === 'auto', merged2._source);
check('merging keeps the previous marker when none is given', (() => {
  writeSettingsFile(mergePath, { quality: 'low' });
  return JSON.parse(readFileSync(mergePath, 'utf8'))._source === 'auto';
})());

// ---------------------------------------------------------------------------
// 6. config normalization + validation
// ---------------------------------------------------------------------------
const good = normalizeConfig({ source: 'provider', provider: 'ai-proxy', model: 'm', size: '1024x1024', quality: 'high', proxy: '' });
check('normalizeConfig returns the provider source', good.source === 'provider');
check('normalizeConfig validates the size', good.size === '1024x1024');
check('normalizeConfig validates the quality', good.quality === 'high');
expectThrow('provider mode requires a provider', () => normalizeConfig({ source: 'provider', model: 'm' }), 'provider is required');
expectThrow('manual mode requires a baseURL', () => normalizeConfig({ source: 'manual', model: 'm' }), 'baseURL is required');
expectThrow('any mode requires a model', () => normalizeConfig({ source: 'provider', provider: 'p' }), 'model is required');
expectThrow('a bad size is rejected before saving', () => normalizeConfig({ source: 'provider', provider: 'p', model: 'm', size: 'huge' }), 'size must look like');
expectThrow('a bad quality is rejected before saving', () => normalizeConfig({ source: 'provider', provider: 'p', model: 'm', quality: 'ultra' }), 'quality must be one of');
const withDefaults = normalizeConfig({}, {
  defaults: { source: 'provider', provider: 'ai-proxy', model: 'gemini-3.1-flash-image', size: DEFAULT_SIZE, quality: DEFAULT_QUALITY },
});
check('defaults fill every field', withDefaults.provider === 'ai-proxy' && withDefaults.model === 'gemini-3.1-flash-image' && withDefaults.size === DEFAULT_SIZE && withDefaults.quality === DEFAULT_QUALITY);
const manual = normalizeConfig({ source: 'manual', baseURL: 'http://h:8319/v1', model: 'm' });
check('manual mode keeps baseURL', manual.baseURL === 'http://h:8319/v1' && manual.source === 'manual');
check('an unknown source falls back to provider', normalizeConfig({ source: 'weird', provider: 'p', model: 'm' }).source === 'provider');
check('DEFAULT_SIZE and DEFAULT_QUALITY are re-exported', DEFAULT_SIZE === '1024x1024' && DEFAULT_QUALITY === 'auto');

await rm(workDir, { recursive: true, force: true });

console.log('');
console.log(failures === 0 ? 'SETTINGS OK' : 'SETTINGS FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
