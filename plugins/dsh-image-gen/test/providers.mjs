/**
 * 提供商读取层（lib/provider.js）测试。
 *
 * 这是「直接下拉选择 dsh 已经配置好的提供商和模型」的数据来源，必须覆盖：
 *   - profile 层的 cordis*.yml 里 llm-pi-ai 行的 providers 被正确收集；
 *   - settings.yaml / settings.yaml.imported 两个旧来源也被读取，且 profile 优先；
 *   - dsh 的自定义 `!!js` 标签不会让整个文件读不出来；
 *   - 模型条目既支持 `- id: xxx` 对象也支持裸字符串；
 *   - 凭证优先从 .credentials.yaml 取，其次环境变量；
 *   - 生图模型 / 编辑模型的识别；
 *   - js-yaml 不可用时内置子集解析器兜底。
 *
 * 全程只往 mkdtemp 的临时目录写，绝不碰真实的 ~/.dsh。
 *
 * Run: node test/providers.mjs
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectProviderBlocks,
  getCredentials,
  getDshSystemProviders,
  homeFromModulePath,
  inferDefaultConfig,
  isEditOnlyModel,
  isImageModel,
  loadDshYaml,
  providerConfigSources,
  resolveActiveProfile,
  resolveToken,
} from '../lib/provider.js';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'dsh-image-providers-'));
const profileDir = join(workDir, 'profiles', 'web');
await mkdir(profileDir, { recursive: true });

/** 一份贴近真实 dsh profile 的 llm-pi-ai 配置。 */
const REAL_PROFILE = `
- id: webserver
  config:
    port: 3080
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ai-proxy:
        displayName: AI Proxy
        apiKeyEnv: AIPROXY_DSH_WEB_ACCESS_TOKEN
        api: openai-responses
        baseURL: http://192.168.1.253:8319/v1
        headers:
          x-ai-proxy-client: dsh
        models:
          - id: gemini-3.1-flash-image
            contextWindow: 131072
            input:
              - text
          - id: grok-imagine-image
            contextWindow: 16000
          - id: grok-imagine-image-2.0
            contextWindow: 64000
          - id: step-5-preview
            contextWindow: 1000000
          - plain-string-model
      other-provider:
        displayName: Another
        apiKeyEnv: OTHER_KEY
        baseURL: https://api.example.com/v1
        models:
          - id: dalle-3
`;

/** dsh 配置里真实存在的 `!!js` 标签。 */
const JS_TAGGED = `
- id: llm-pi-ai
  config:
    providers:
      tagged:
        displayName: Tagged Provider
        apiKeyEnv: TAGGED_KEY
        baseURL: https://tagged.example.com/v1
        models:
          - id: flux-pro
`;

/** 旧版 dsh 的 settings.yaml（0.1.x）：providers 挂在 llm-pi-ai 段下。 */
const LEGACY_SETTINGS = `
llm-pi-ai:
  providers:
    legacy:
      displayName: Legacy
      apiKeyEnv: LEGACY_KEY
      baseURL: http://127.0.0.1:9999/v1
      models:
        - id: sd-xl
`;

await writeFile(join(profileDir, 'cordis.yml'), '# profile root\n[]\n');
await writeFile(join(profileDir, 'cordis.patch.yml'), REAL_PROFILE, 'utf8');
await writeFile(join(workDir, 'settings.yaml'), LEGACY_SETTINGS, 'utf8');

const opts = { dshHome: workDir, profile: 'web' };

// ---------------------------------------------------------------------------
// 1. config source discovery
// ---------------------------------------------------------------------------
const sources = providerConfigSources(opts);
check('settings.yaml is read', sources.some((f) => f.endsWith('settings.yaml')));
check('settings.yaml.imported is read', sources.some((f) => f.endsWith('settings.yaml.imported')));
check('profile cordis.yml is read', sources.some((f) => f.endsWith(join('profiles', 'web', 'cordis.yml'))));
check('profile cordis.patch.yml is read', sources.some((f) => f.endsWith('cordis.patch.yml')));
check('non-cordis files are skipped', !sources.some((f) => f.endsWith('pnpm-lock.yaml')));

// ---------------------------------------------------------------------------
// 2. provider collection from the profile layer
// ---------------------------------------------------------------------------
const providers = getDshSystemProviders(opts);
check('collects the profile provider', providers['ai-proxy'] !== undefined, Object.keys(providers).join(','));
check('uses displayName as the name', providers['ai-proxy'].name === 'AI Proxy', providers['ai-proxy'].name);
check('reads baseURL', providers['ai-proxy'].baseURL === 'http://192.168.1.253:8319/v1', providers['ai-proxy'].baseURL);
check('reads apiKeyEnv', providers['ai-proxy'].apiKeyEnv === 'AIPROXY_DSH_WEB_ACCESS_TOKEN', providers['ai-proxy'].apiKeyEnv);
check('reads headers', providers['ai-proxy'].headers['x-ai-proxy-client'] === 'dsh');
check('expands `- id:` model entries', providers['ai-proxy'].models.includes('gemini-3.1-flash-image'));
check('keeps bare string model entries', providers['ai-proxy'].models.includes('plain-string-model'));
check('lists every model', providers['ai-proxy'].models.length === 5, JSON.stringify(providers['ai-proxy'].models));
check('identifies image models', JSON.stringify(providers['ai-proxy'].imageModels) === JSON.stringify(['gemini-3.1-flash-image', 'grok-imagine-image', 'grok-imagine-image-2.0']), JSON.stringify(providers['ai-proxy'].imageModels));
check('collects the second provider too', providers['other-provider'] !== undefined);
check('legacy settings.yaml providers are merged', providers.legacy !== undefined, Object.keys(providers).join(','));
check('the legacy provider name comes from displayName', providers.legacy && providers.legacy.name === 'Legacy');
check('a provider without displayName falls back to its id', (() => {
  const doc = loadDshYaml('llm-pi-ai:\n  providers:\n    bare:\n      apiKeyEnv: B\n      baseURL: http://h/v1\n      models:\n        - id: m\n');
  const out = {};
  collectProviderBlocks(doc, out);
  return out.bare !== undefined && out.bare.displayName === undefined;
})());
check('a row with only id/name is also collected', (() => {
  const doc = loadDshYaml('- id: llm-pi-ai\n  config:\n    providers:\n      rowid:\n        baseURL: http://h/v1\n');
  const out = {};
  collectProviderBlocks(doc, out);
  return out.rowid !== undefined;
})());

// ---------------------------------------------------------------------------
// 3. the !!js tag must not break the whole file
// ---------------------------------------------------------------------------
const tagged = getDshSystemProviders({ dshHome: workDir, profile: 'web' });
void tagged;
await writeFile(join(profileDir, 'cordis.patch.yml'), JS_TAGGED, 'utf8');
const withTags = getDshSystemProviders(opts);
check('a !!js tag does not drop the file', withTags.tagged !== undefined, Object.keys(withTags).join(','));
check('the tagged provider still lists its model', withTags.tagged && withTags.tagged.models.includes('flux-pro'), JSON.stringify(withTags.tagged && withTags.tagged.models));
const legacyOnly = getDshSystemProviders({ dshHome: workDir, profile: 'nonexistent' });
check('a missing profile dir still yields the legacy providers', legacyOnly.legacy !== undefined, Object.keys(legacyOnly).join(','));
await writeFile(join(profileDir, 'cordis.patch.yml'), REAL_PROFILE, 'utf8');

// ---------------------------------------------------------------------------
// 4. the built-in YAML subset parser (js-yaml absent fallback)
// ---------------------------------------------------------------------------
const simple = loadDshYaml(REAL_PROFILE);
check('the subset parser walks a patch list', Array.isArray(simple) && simple.length === 2, JSON.stringify(simple && simple.length));
const fromSimple = {};
for (const entry of Array.isArray(simple) ? simple : []) collectProviderBlocks(entry, fromSimple);
check('the subset parser finds the providers', fromSimple['ai-proxy'] !== undefined, Object.keys(fromSimple).join(','));
check('the subset parser reads baseURL', fromSimple['ai-proxy'] && fromSimple['ai-proxy'].baseURL === 'http://192.168.1.253:8319/v1');
check('the subset parser strips quotes', (() => {
  const doc = loadDshYaml('a:\n  b: "quoted value"\n');
  return doc && doc.a && doc.a.b === 'quoted value';
})());
check('the subset parser strips an inline comment', (() => {
  const doc = loadDshYaml('a:\n  b: value # trailing comment\n');
  return doc && doc.a && doc.a.b === 'value';
})());
check('the subset parser keeps # inside a value', (() => {
  const doc = loadDshYaml('a:\n  b: http://h/path#frag\n');
  return doc && doc.a && doc.a.b === 'http://h/path#frag';
})());
check('the subset parser handles a disabled js tag as a scalar', (() => {
  const doc = loadDshYaml('- id: x\n  disabled: !!js process.platform === \'win32\'\n');
  return Array.isArray(doc) && doc[0].id === 'x';
})());

// ---------------------------------------------------------------------------
// 5. credentials + token resolution
// ---------------------------------------------------------------------------
await writeFile(
  join(workDir, '.credentials.yaml'),
  'version: 1\nrefs:\n  AIPROXY_DSH_WEB_ACCESS_TOKEN: token-from-file\n  OTHER_KEY: other-from-file\n',
  'utf8',
);
const creds = getCredentials(opts);
check('reads credential refs', creds.AIPROXY_DSH_WEB_ACCESS_TOKEN === 'token-from-file', JSON.stringify(creds));
const fileToken = resolveToken({ apiKeyEnv: 'AIPROXY_DSH_WEB_ACCESS_TOKEN' }, { dshHome: workDir, env: {} });
check('the credentials file wins over the environment', fileToken.token === 'token-from-file' && fileToken.from === 'credentials:AIPROXY_DSH_WEB_ACCESS_TOKEN', fileToken.from);
process.env.ONLY_ENV_KEY = 'token-from-env';
const envToken = resolveToken({ apiKeyEnv: 'ONLY_ENV_KEY' }, { dshHome: workDir });
check('falls back to the environment', envToken.token === 'token-from-env' && envToken.from === 'env:ONLY_ENV_KEY', envToken.from);
const noToken = resolveToken({ apiKeyEnv: 'NO_SUCH_VAR_XYZ' }, { dshHome: workDir, env: {} });
check('reports no token instead of throwing', noToken.token === '' && noToken.from === 'none');
delete process.env.ONLY_ENV_KEY;
const noCreds = getCredentials({ dshHome: join(workDir, 'nowhere') });
check('a missing credentials file yields an empty map', Object.keys(noCreds).length === 0);

// ---------------------------------------------------------------------------
// 6. image / edit model classification
// ---------------------------------------------------------------------------
check('gemini-3.1-flash-image is an image model', isImageModel('gemini-3.1-flash-image'));
check('grok-imagine-image is an image model', isImageModel('grok-imagine-image'));
check('flux-pro is an image model', isImageModel('flux-pro'));
check('dall-e-3 style ids are image models', isImageModel('dall-e-3'));
check('step-5-preview is not an image model', !isImageModel('step-5-preview'));
check('glm-5.3 is not an image model', !isImageModel('glm-5.3'));
check('gpt-5.6-sol is not an image model', !isImageModel('gpt-5.6-sol'));
check('gpt-image-1 is an image model', isImageModel('gpt-image-1'));
check('gemini-2.5-flash-image-edit is edit-only', isEditOnlyModel('gemini-2.5-flash-image-edit'));
check('a plain generation model is not edit-only', !isEditOnlyModel('grok-imagine-image'));
check('an id merely containing "edit" as a word is edit-only', isEditOnlyModel('some/edit/model'));

// ---------------------------------------------------------------------------
// 6b. active-profile resolution (the desktop regression)
// ---------------------------------------------------------------------------
// 桌面端宿主不会把 DSH_PROFILE 写进进程环境（只有模型 shell 调用时由
// dsh-shell-env 临时注入），旧实现一律退回 'web'，于是在只有 desktop profile
// 的机器上 providers 全空。这里逐级锁住解析顺序。
const desktopArgv = [
  'DeepSeek Harness.exe',
  '--expose-internals',
  '...\\dsh-desktop-host\\lib\\index.js',
  join(workDir, 'profiles', 'desktop'),
];
check(
  'DSH_PROFILE still wins when it is set',
  resolveActiveProfile({ env: { DSH_PROFILE: 'web' }, argv: ['node'] }) === 'web',
);
check(
  'a --profile flag is honoured',
  resolveActiveProfile({ env: {}, argv: ['node', 'dsh', '--profile', 'tui'] }) === 'tui',
);
check(
  'the desktop host profile directory (argv) is honoured',
  resolveActiveProfile({ env: {}, argv: desktopArgv }) === 'desktop',
);
check(
  'the install path under profiles/<name>/ carries the profile',
  resolveActiveProfile({
    env: {},
    argv: ['node'],
    moduleUrl: 'file:///C:/u/.dsh/profiles/desktop/node_modules/@weniatall/dsh-image-gen/lib/provider.js',
  }) === 'desktop',
);
check(
  'no evidence at all still falls back to web',
  resolveActiveProfile({
    env: {},
    argv: ['node'],
    moduleUrl: 'file:///tmp/unpacked/lib/provider.js',
    dshHome: join(workDir, 'nowhere'),
  }) === 'web',
);
check(
  'the harness home can be inferred from the install path',
  homeFromModulePath(
    'file:///C:/u/.dsh/profiles/desktop/node_modules/@weniatall/dsh-image-gen/lib/provider.js',
  ) === join('C:', 'u', '.dsh'),
  homeFromModulePath(
    'file:///C:/u/.dsh/profiles/desktop/node_modules/@weniatall/dsh-image-gen/lib/provider.js',
  ),
);
check(
  'the home-level cordis.patch.yml layer is part of the sources',
  providerConfigSources({ dshHome: workDir, profile: 'web' }).slice(-1)[0] === join(workDir, 'cordis.patch.yml'),
  providerConfigSources({ dshHome: workDir, profile: 'web' }).slice(-1)[0],
);

// dsh 把 $DSH_HOME/cordis.patch.yml 叠加在每个 profile 之上，里面的 llm-pi-ai
// 行同样生效；只读 profile 目录会漏掉只在家庭层配置的提供商。
const homeLayer = await mkdtemp(join(tmpdir(), 'dsh-image-home-layer-'));
await mkdir(join(homeLayer, 'profiles', 'desktop'), { recursive: true });
await writeFile(join(homeLayer, 'profiles', 'desktop', 'cordis.yml'), '# root\n[]\n');
await writeFile(
  join(homeLayer, 'cordis.patch.yml'),
  '- id: llm-pi-ai\n  config:\n    providers:\n      home-layer:\n        displayName: Home Layer\n        apiKeyEnv: HOME_KEY\n        baseURL: http://home.local/v1\n        models:\n          - id: home-image\n',
  'utf8',
);
const homeProviders = getDshSystemProviders({ dshHome: homeLayer, profile: 'desktop' });
check('a provider declared only in the home layer is collected', homeProviders['home-layer'] !== undefined, Object.keys(homeProviders).join(','));
check(
  'the home-layer provider exposes its image model',
  homeProviders['home-layer']?.imageModels.join(',') === 'home-image',
  JSON.stringify(homeProviders['home-layer']?.imageModels),
);
check(
  'the home layer is part of the profile layer used for inference',
  inferDefaultConfig({ dshHome: homeLayer, profile: 'desktop' }).provider === 'home-layer',
  JSON.stringify(inferDefaultConfig({ dshHome: homeLayer, profile: 'desktop' })),
);
await rm(homeLayer, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 7. default inference
// ---------------------------------------------------------------------------
const inferred = inferDefaultConfig(opts);
check('infers the provider that owns image models', inferred.provider === 'ai-proxy', inferred.provider);
check('infers an image model, not a chat model', providers['ai-proxy'].imageModels.includes(inferred.model), inferred.model);
check('the inferred provider is the one with image models', providers[inferred.provider].imageModels.length > 0);
check('the inferred model is not the legacy sd-xl', inferred.model !== 'sd-xl', inferred.model);

const chatOnly = await mkdtemp(join(tmpdir(), 'dsh-image-chatonly-'));
const chatProfile = join(chatOnly, 'profiles', 'web');
await mkdir(chatProfile, { recursive: true });
await writeFile(
  join(chatProfile, 'cordis.patch.yml'),
  '- id: llm-pi-ai\n  config:\n    providers:\n      chat:\n        displayName: Chat\n        apiKeyEnv: C\n        baseURL: http://h/v1\n        models:\n          - id: glm-5.3\n',
  'utf8',
);
const chatInferred = inferDefaultConfig({ dshHome: chatOnly, profile: 'web' });
check('a chat-only deployment still gets a usable default', chatInferred.provider === 'chat' && chatInferred.model === 'gemini-3.1-flash-image', JSON.stringify(chatInferred));
const emptyHome = join(workDir, 'empty');
await mkdir(emptyHome, { recursive: true });
const emptyInferred = inferDefaultConfig({ dshHome: emptyHome, profile: 'web' });
check('no providers at all falls back to ai-proxy/gemini', emptyInferred.provider === 'ai-proxy' && emptyInferred.model === 'gemini-3.1-flash-image', JSON.stringify(emptyInferred));

await rm(chatOnly, { recursive: true, force: true });
await rm(workDir, { recursive: true, force: true });

console.log('');
console.log(failures === 0 ? 'PROVIDERS OK' : 'PROVIDERS FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
