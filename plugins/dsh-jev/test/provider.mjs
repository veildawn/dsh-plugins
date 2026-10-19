/**
 * 提供商读取层（lib/provider.js）测试。
 *
 * 「直接下拉选择 dsh 已经配置好的提供商和模型」的数据来源就是这一层，必须覆盖：
 *   - profile 层的 cordis*.yml 里 llm-pi-ai 行的 providers 被正确收集；
 *   - settings.yaml / settings.yaml.imported 两个旧来源也被读取，且 profile 优先；
 *   - 决策模型（jev / systemone / decision）被识别并排到前面；
 *   - 凭证优先从 .credentials.yaml 取，其次环境变量；
 *   - js-yaml 不可用（或遇到 !!js 标签）时内置子集解析器兜底。
 *
 * 全程只往 mkdtemp 的临时目录写，绝不碰真实的 ~/.dsh。
 *
 * Run: node test/provider.mjs
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'dsh-jev-providers-'));
const profileDir = join(workDir, 'profiles', 'web');
await mkdir(profileDir, { recursive: true });

// 必须在动态 import 之前设置：provider.js 在模块加载时读取 DSH_HOME / DSH_PROFILE。
process.env.DSH_HOME = workDir;
process.env.DSH_PROFILE = 'web';

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
          - id: jev-latest
            contextWindow: 200000
            input:
              - text
              - image
          - id: deepseek-v4.1-flash
            contextWindow: 1000000
          - id: grok-imagine-image
            contextWindow: 16000
          - plain-string-model
      other-provider:
        displayName: Another
        apiKeyEnv: OTHER_KEY
        baseURL: https://api.example.com/v1
        models:
          - id: some-chat-model
      classifier-route:
        displayName: Classifier Route
        api: typesafe-system-one
        baseURL: https://api.typesafe.ai/v1
        models:
          - id: gateway-classifier
          - id: gateway-chat
      mixed-route:
        displayName: Mixed Route
        baseURL: https://mixed.example.com/v1
        models:
          - id: model-by-type
            type: classifier
          - id: model-by-modality
            input:
              - text
              - decision
          - id: model-by-name
            name: Jev 决策模型
          - id: model-by-modality-field
            modality: decision
          - id: model-declared-text
            name: Jev decision helper
            modality: text
          - id: plain-chat
            input:
              - text
              - image
`;

/** dsh 配置里真实存在的 `!!js` 标签，不能让整个文件解析失败。 */
const JS_TAGGED = `
- id: llm-pi-ai
  config:
    providers:
      tagged:
        displayName: Tagged Provider
        apiKeyEnv: TAGGED_KEY
        baseURL: https://tagged.example.com/v1
        models:
          - id: systemone
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
        - id: decision-model
    ai-proxy:
      displayName: Legacy AI Proxy
      baseURL: http://127.0.0.1:1111/v1
      models:
        - id: legacy-only
`;

await writeFile(join(profileDir, 'cordis.yml'), '# profile root\n[]\n');
await writeFile(join(profileDir, 'cordis.patch.yml'), REAL_PROFILE, 'utf8');
await mkdir(join(workDir, 'profiles', 'tagged'), { recursive: true });
await writeFile(join(workDir, 'profiles', 'tagged', 'cordis.patch.yml'), JS_TAGGED, 'utf8');
// 只有单个 profile 的主目录：用来验证「唯一候选」兜底。
await mkdir(join(workDir, 'profiles-single', 'profiles', 'desktop'), { recursive: true });
await writeFile(join(workDir, 'profiles-single', 'profiles', 'desktop', 'cordis.yml'), '# root\n[]\n');
await writeFile(join(workDir, 'profiles-single', 'profiles', 'desktop', 'cordis.patch.yml'), REAL_PROFILE, 'utf8');
// 空主目录：什么都不该被推断出来。
await mkdir(join(workDir, 'profiles-empty'), { recursive: true });
await writeFile(join(workDir, 'settings.yaml'), LEGACY_SETTINGS, 'utf8');
await writeFile(join(workDir, '.credentials.yaml'), `
refs:
  AIPROXY_DSH_WEB_ACCESS_TOKEN: cred-from-yaml
  OTHER_KEY: other-from-yaml
`, 'utf8');

const provider = await import('../lib/provider.js');
const {
  getDshSystemProviders,
  getCredentials,
  inferDefaultProvider,
  isDecisionModel,
  resolveToken,
  providerConfigSources,
  _internals,
} = provider;

const opts = { dshHome: workDir, profile: 'web' };

// ---------------------------------------------------------------------------
// 1. config source discovery
// ---------------------------------------------------------------------------
const sources = providerConfigSources(opts);
check('settings.yaml is read', sources.some((f) => f.endsWith('settings.yaml')));
check('profile cordis.patch.yml is read', sources.some((f) => f.endsWith('cordis.patch.yml')));
check('profile cordis.yml is read', sources.some((f) => f.endsWith('cordis.yml')));

// ---------------------------------------------------------------------------
// 2. provider collection
// ---------------------------------------------------------------------------
const providers = getDshSystemProviders(opts);
check('collects ai-proxy from the profile layer', providers['ai-proxy'] !== undefined, Object.keys(providers).join(','));
check('collects the legacy settings.yaml provider', providers.legacy !== undefined, Object.keys(providers).join(','));
check('profile layer overrides the legacy provider row', providers['ai-proxy'].baseURL === 'http://192.168.1.253:8319/v1', providers['ai-proxy']?.baseURL);
check('collects models from object entries', providers['ai-proxy'].models.includes('jev-latest'), JSON.stringify(providers['ai-proxy'].models));
check('collects models from plain string entries', providers['ai-proxy'].models.includes('plain-string-model'), JSON.stringify(providers['ai-proxy'].models));
check('keeps provider headers', providers['ai-proxy'].headers['x-ai-proxy-client'] === 'dsh', JSON.stringify(providers['ai-proxy'].headers));
check('keeps provider apiKeyEnv', providers['ai-proxy'].apiKeyEnv === 'AIPROXY_DSH_WEB_ACCESS_TOKEN', providers['ai-proxy'].apiKeyEnv);
check('uses displayName as the human name', providers['ai-proxy'].name === 'AI Proxy', providers['ai-proxy'].name);
const taggedProviders = getDshSystemProviders({ dshHome: workDir, profile: 'tagged' });
check('parses a provision containing !!js tags', taggedProviders.tagged !== undefined, Object.keys(taggedProviders).join(','));

// ---------------------------------------------------------------------------
// 3. decision-model detection
// ---------------------------------------------------------------------------
for (const model of ['jev-latest', 'typesafe-ai/jev', 'jev', 'systemone', 'decision-model', 'my-decision-classifier']) {
  check('detects decision model: ' + model, isDecisionModel(model) === true, String(isDecisionModel(model)));
}
for (const model of ['deepseek-v4.1-flash', 'grok-imagine-image', 'plain-string-model']) {
  check('does not misclassify: ' + model, isDecisionModel(model) === false, String(isDecisionModel(model)));
}
check(
  'provider row exposes decisionModels',
  providers['ai-proxy'].decisionModels.includes('jev-latest') &&
    providers['ai-proxy'].decisionModels.length === 1,
  JSON.stringify(providers['ai-proxy'].decisionModels),
);

// ---------------------------------------------------------------------------
// 3b. structured decision-model detection: protocol / type / name / modality
// ---------------------------------------------------------------------------
const classifierRoute = providers['classifier-route'];
check(
  'a classifier api marks every model on the route as a decision model',
  classifierRoute.decisionModels.join(',') === 'gateway-classifier,gateway-chat',
  JSON.stringify(classifierRoute.decisionModels),
);
check('provider rows keep the route api', classifierRoute.api === 'typesafe-system-one', classifierRoute.api);

const mixedRoute = providers['mixed-route'];
check(
  'a model-level classifier type is detected',
  mixedRoute.decisionModels.includes('model-by-type'),
  JSON.stringify(mixedRoute.decisionModels),
);
check(
  'a non-text/image input modality is detected as a decision capability',
  mixedRoute.decisionModels.includes('model-by-modality'),
  JSON.stringify(mixedRoute.decisionModels),
);
check(
  'a decision-model display name is detected',
  mixedRoute.decisionModels.includes('model-by-name'),
  JSON.stringify(mixedRoute.decisionModels),
);
check(
  'a plain multimodal chat model is not dragged into the decision group',
  mixedRoute.decisionModels.includes('plain-chat') === false,
  JSON.stringify(mixedRoute.decisionModels),
);
check(
  'a static modality: decision field is detected',
  mixedRoute.decisionModels.includes('model-by-modality-field'),
  JSON.stringify(mixedRoute.decisionModels),
);
check(
  'a static modality: text overrides the name-based guess',
  mixedRoute.decisionModels.includes('model-declared-text') === false,
  JSON.stringify(mixedRoute.decisionModels),
);
check(
  'modelInfo exposes the static modality',
  mixedRoute.modelInfo.find((entry) => entry.id === 'model-by-modality-field')?.modality === 'decision',
  JSON.stringify(mixedRoute.modelInfo.find((entry) => entry.id === 'model-by-modality-field')),
);

const jevInfo = providers['ai-proxy'].modelInfo.find((entry) => entry.id === 'jev-latest');
check('modelInfo exposes the input modalities', Array.isArray(jevInfo?.input) && jevInfo.input.length > 0, JSON.stringify(jevInfo));
check('modelInfo marks the decision model', jevInfo?.decisionModel === true, JSON.stringify(jevInfo));
check('modelInfo keeps the provider api for models without their own', jevInfo?.api === 'openai-responses', JSON.stringify(jevInfo));
const plainInfo = providers['ai-proxy'].modelInfo.find((entry) => entry.id === 'plain-string-model');
check('a bare-string model entry still produces modelInfo', plainInfo !== undefined && plainInfo.input.length === 0, JSON.stringify(plainInfo));
check('modelInfo marks a plain chat model as non-decision', plainInfo?.decisionModel === false, JSON.stringify(plainInfo));

const { isDecisionModelEntry, normalizeModelEntry } = _internals;
check(
  'isDecisionModelEntry accepts a classifier api',
  isDecisionModelEntry({ id: 'anything' }, 'openai-decisions') === true,
);
check(
  'isDecisionModelEntry accepts a classifier type',
  isDecisionModelEntry({ id: 'anything', type: 'classifier' }) === true,
);
check(
  'isDecisionModelEntry rejects a plain text chat model',
  isDecisionModelEntry({ id: 'anything', input: ['text'] }) === false,
);
check(
  'normalizeModelEntry fills api from the route',
  normalizeModelEntry({ id: 'x' }, 'typesafe-system-one').api === 'typesafe-system-one',
);
check(
  'normalizeModelEntry keeps an unknown modality field',
  normalizeModelEntry({ id: 'x', modality: 'decision' }, '').modality === 'decision',
);

// ---------------------------------------------------------------------------
// 4. default provider inference
// ---------------------------------------------------------------------------
const inferred = inferDefaultProvider(opts);
check('inferDefaultProvider picks a provider with a decision model', inferred.provider === 'ai-proxy', inferred.provider);
check('inferDefaultProvider picks its decision model', inferred.model === 'jev-latest', inferred.model);

// ---------------------------------------------------------------------------
// 5. credentials + token resolution
// ---------------------------------------------------------------------------
const creds = getCredentials(opts);
check('reads refs from .credentials.yaml', creds.AIPROXY_DSH_WEB_ACCESS_TOKEN === 'cred-from-yaml', JSON.stringify(creds));

const declared = resolveToken({ apiKeyEnv: 'AIPROXY_DSH_WEB_ACCESS_TOKEN' }, { dshHome: workDir, env: {} });
check('declared apiKeyEnv resolves from credentials', declared.token === 'cred-from-yaml' && declared.from === 'credentials:AIPROXY_DSH_WEB_ACCESS_TOKEN', JSON.stringify(declared));

const fromEnv = resolveToken({ apiKeyEnv: 'ONLY_IN_ENV' }, { dshHome: workDir, env: { ONLY_IN_ENV: 'env-token' } });
check('falls back to the environment', fromEnv.token === 'env-token' && fromEnv.from === 'env:ONLY_IN_ENV', JSON.stringify(fromEnv));

const credentialsWin = resolveToken(
  { apiKeyEnv: 'AIPROXY_DSH_WEB_ACCESS_TOKEN' },
  { dshHome: workDir, env: { AIPROXY_DSH_WEB_ACCESS_TOKEN: 'env-token' } },
);
check('credentials win over the environment', credentialsWin.token === 'cred-from-yaml', JSON.stringify(credentialsWin));

const missingDeclared = resolveToken(
  { apiKeyEnv: 'DECLARED_BUT_MISSING' },
  { dshHome: workDir, env: { TYPESAFE_API_KEY: 'should-not-be-used' } },
);
check(
  'a declared but missing apiKeyEnv never falls through to another provider key',
  missingDeclared.token === '' && missingDeclared.from === 'none',
  JSON.stringify(missingDeclared),
);

const undeclared = resolveToken({ apiKeyEnv: '' }, { dshHome: workDir, env: { JEV_API_KEY: 'jev-key' } });
check('an undeclared provider falls back to the shared Jev variable', undeclared.token === 'jev-key', JSON.stringify(undeclared));

// ---------------------------------------------------------------------------
// 6. active-profile resolution (the desktop regression)
// ---------------------------------------------------------------------------
// 桌面端宿主不会把 DSH_PROFILE 写进进程环境（只有模型 shell 调用时由
// dsh-shell-env 临时注入），旧实现一律退回 'web'，于是在只有 desktop profile
// 的机器上 providers 全空。这里逐级锁住解析顺序。
const desktopArgv = [
  'DeepSeek Harness.exe',
  '--expose-internals',
  '...\\dsh-desktop-host\\lib\\index.js',
  '...\\app.asar\\dsh',
  join(workDir, 'profiles', 'desktop'),
  '...\\runtime\\primary-runtime',
];
check(
  'DSH_PROFILE still wins when it is set',
  provider.resolveActiveProfile({ env: { DSH_PROFILE: 'web' }, argv: ['node'] }) === 'web',
);
check(
  'a --profile flag is honoured',
  provider.resolveActiveProfile({ env: {}, argv: ['node', 'dsh', '--profile', 'tui'] }) === 'tui',
);
check(
  'a --profile=<name> flag is honoured',
  provider.resolveActiveProfile({ env: {}, argv: ['node', 'dsh', '--profile=desk'] }) === 'desk',
);
check(
  'the desktop host profile directory (argv) is honoured',
  provider.resolveActiveProfile({ env: {}, argv: desktopArgv }) === 'desktop',
);
check(
  'the install path under profiles/<name>/ carries the profile',
  provider.resolveActiveProfile({
    env: {},
    argv: ['node'],
    moduleUrl: 'file:///C:/u/.dsh/profiles/desktop/node_modules/@weniatall/dsh-jev/lib/provider.js',
  }) === 'desktop',
);
check(
  'a single profile on disk is used instead of the web fallback',
  provider.resolveActiveProfile({
    env: {},
    argv: ['node'],
    moduleUrl: 'file:///tmp/unpacked/lib/provider.js',
    dshHome: join(workDir, 'profiles-single'),
  }) === 'desktop',
  provider.resolveActiveProfile({
    env: {},
    argv: ['node'],
    moduleUrl: 'file:///tmp/unpacked/lib/provider.js',
    dshHome: join(workDir, 'profiles-single'),
  }),
);
check(
  'no evidence at all still falls back to web',
  provider.resolveActiveProfile({
    env: {},
    argv: ['node'],
    moduleUrl: 'file:///tmp/unpacked/lib/provider.js',
    dshHome: join(workDir, 'profiles-empty'),
  }) === 'web',
);
check(
  'listProfiles ignores directories without cordis.yml',
  provider.listProfiles(workDir).join(',') === 'web',
  provider.listProfiles(workDir).join(','),
);
// 用平台原生路径反推出的 URL 做输入：fileURLToPath 在 Windows 与 POSIX 上对
// 'file:///C:/...' 的解释不同（前者 'C:\...'，后者 '/C:/...'），直接写死
// Windows 风格的 file: URL 会让断言在 Linux CI 上必败。
const installHome = join(homedir(), 'harness-home');
const installModuleUrl = pathToFileURL(
  join(installHome, 'profiles', 'desktop', 'node_modules', '@weniatall', 'dsh-jev', 'lib', 'provider.js'),
).href;
check(
  'the harness home can be inferred from the install path',
  provider.homeFromModulePath(installModuleUrl) === installHome,
  provider.homeFromModulePath(installModuleUrl),
);
check(
  'the home-level cordis.patch.yml layer is part of the sources',
  providerConfigSources({ dshHome: workDir, profile: 'web' }).slice(-1)[0] === join(workDir, 'cordis.patch.yml'),
  providerConfigSources({ dshHome: workDir, profile: 'web' }).slice(-1)[0],
);

// dsh 把 $DSH_HOME/cordis.patch.yml 叠加在每个 profile 之上，里面的 llm-pi-ai
// 行同样生效；只读 profile 目录会漏掉只在家庭层配置的提供商。
const homeLayer = await mkdtemp(join(tmpdir(), 'dsh-jev-home-layer-'));
await mkdir(join(homeLayer, 'profiles', 'desktop'), { recursive: true });
await writeFile(join(homeLayer, 'profiles', 'desktop', 'cordis.yml'), '# root\n[]\n');
await writeFile(join(homeLayer, 'profiles', 'desktop', 'cordis.patch.yml'), '- id: webserver\n  config:\n    port: 3080\n', 'utf8');
await writeFile(
  join(homeLayer, 'cordis.patch.yml'),
  '- id: llm-pi-ai\n  config:\n    providers:\n      home-layer:\n        displayName: Home Layer\n        apiKeyEnv: HOME_KEY\n        baseURL: http://home.local/v1\n        models:\n          - id: home-decision\n            modality: decision\n',
  'utf8',
);
const homeProviders = getDshSystemProviders({ dshHome: homeLayer, profile: 'desktop' });
check('a provider declared only in the home layer is collected', homeProviders['home-layer'] !== undefined, Object.keys(homeProviders).join(','));
check(
  'the home-layer provider exposes its decision model',
  homeProviders['home-layer']?.decisionModels.join(',') === 'home-decision',
  JSON.stringify(homeProviders['home-layer']?.decisionModels),
);
check(
  'the home layer is part of the profile layer used for inference',
  inferDefaultProvider({ dshHome: homeLayer, profile: 'desktop' }).provider === 'home-layer',
  JSON.stringify(inferDefaultProvider({ dshHome: homeLayer, profile: 'desktop' })),
);
await rm(homeLayer, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 7. built-in YAML fallback
// ---------------------------------------------------------------------------
const fallback = _internals.parseSimpleYaml(`
llm-pi-ai:
  providers:
    p1:
      displayName: P1
      baseURL: http://127.0.0.1:1/v1
      models:
        - id: jev-latest
`);
check(
  'the built-in YAML subset parser understands a provider block',
  fallback?.['llm-pi-ai']?.providers?.p1?.baseURL === 'http://127.0.0.1:1/v1' &&
    fallback['llm-pi-ai'].providers.p1.models[0].id === 'jev-latest',
  JSON.stringify(fallback),
);

await rm(workDir, { recursive: true, force: true });

console.log('');
console.log(failures === 0 ? 'PROVIDER OK' : 'PROVIDER FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
