#!/usr/bin/env node
/**
 * test/bundle-install.mjs
 *
 * Independent acceptance harness for the `dsh.bundle.patch` install path of
 * dsh-plugin-jev (spec: specs/feature-jev-bundle-install.yaml).
 *
 * Written by the verifier (bundle-verify), not by the feature author. It calls
 * the REAL plugin-manager / dsh-app-boot code paths that `dsh plugin ... add`
 * and `dsh --dump-config` use; it does not re-implement their logic and does
 * not shell out to any script supplied by the implementer.
 *
 * Properties:
 *   - Node ESM, zero third-party dependencies, zero network.
 *   - Exit code 0 = every assertion PASSed; non-zero = at least one FAIL.
 *   - Every assertion prints PASS / FAIL / SKIP plus a locatable diagnostic.
 *
 * What it deliberately does NOT do:
 *   - It never installs anything (`dsh plugin ... add` belongs to task-4's
 *     isolated `jevtest` profile run), so it stays offline and side-effect free.
 *   - It never writes inside the repository, ~/.dsh/profiles/web/**, or any
 *     pre-existing profile. The only writes are inside its own mkdtemp dir.
 *
 * Environment note (measured, not assumed): loading ANY profile — including
 * `dsh --profile <p> --dump-config` — makes dsh rewrite `<profile>/cordis.yml`
 * with the canonical empty root list (apps/cli `prepareProfile()`:
 * "The root is always rewritten"). That file is machine-managed and its mtime
 * therefore moves on every dump-config. SPEC criterion 8 watches
 * `cordis.patch.yml` and `lib/index.js`; this harness watches those two by
 * hash AND mtime, and additionally watches `cordis.yml` by CONTENT hash only.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

const out = (line = '') => process.stdout.write(`${line}\n`);

function pass(id, message, detail) {
  passed += 1;
  out(`[PASS] ${id} ${message}`);
  if (detail !== undefined) out(`       ${detail}`);
}

function fail(id, message, diagnostic) {
  failed += 1;
  out(`[FAIL] ${id} ${message}`);
  if (diagnostic !== undefined) {
    for (const line of String(diagnostic).split('\n')) out(`       ${line}`);
  }
  failures.push(`${id} ${message}`);
}

function skip(id, message, why) {
  skipped += 1;
  out(`[SKIP] ${id} ${message}`);
  if (why !== undefined) out(`       ${why}`);
}

/** Assert a strict equality, printing expected/actual on mismatch. */
function expectEq(id, message, actual, expected, extra) {
  if (Object.is(actual, expected)) {
    pass(id, message, `actual = ${fmt(actual)}`);
    return true;
  }
  fail(
    id,
    message,
    [
      `expected: ${fmt(expected)}`,
      `actual:   ${fmt(actual)}`,
      extra === undefined ? undefined : String(extra),
    ]
      .filter((v) => v !== undefined)
      .join('\n'),
  );
  return false;
}

function expectTrue(id, message, condition, diagnostic) {
  if (condition) {
    pass(id, message);
    return true;
  }
  fail(id, message, diagnostic);
  return false;
}

function fmt(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  return JSON.stringify(value);
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function fingerprint(file) {
  if (!existsSync(file)) return { file, exists: false };
  const st = statSync(file);
  return { file, exists: true, hash: sha256(file), mtimeMs: st.mtimeMs, size: st.size };
}

function fingerprintLine(fp) {
  return fp.exists ? `${fp.file} sha256=${fp.hash} mtimeMs=${fp.mtimeMs} size=${fp.size}` : `${fp.file} MISSING`;
}

function fingerprintsEqual(a, b) {
  return a.exists === b.exists && (!a.exists || (a.hash === b.hash && a.mtimeMs === b.mtimeMs));
}

function countHits(text, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

// ---------------------------------------------------------------------------
// environment discovery
// ---------------------------------------------------------------------------

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_PACKAGE_JSON = join(REPO, 'package.json');
const REPO_PATCH = join(REPO, 'dsh.patch.yml');
const REPO_LIB = join(REPO, 'lib', 'index.js');
const DSH_HOME = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh');
const WEB_DIR = join(DSH_HOME, 'profiles', 'web');
const WEB_PATCH = join(WEB_DIR, 'cordis.patch.yml');
const WEB_ROOT = join(WEB_DIR, 'cordis.yml');
const HEADLESS_PATCH = join(DSH_HOME, 'profiles', 'headless', 'cordis.patch.yml');

const CANONICAL_EMPTY_ROOT = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`;

function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** The pnpm shim records its real target; fall back to the exec line. */
function shimTarget(shim) {
  const text = readFileSync(shim, 'utf8');
  const commented = text.match(/#\s*cmd-shim-target=(\S+)/);
  if (commented) return commented[1];
  const exec = text.match(/(\/[^\s"']*\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js)/);
  return exec?.[1];
}

function runDsh(args, label) {
  const started = Date.now();
  const result = spawnSync(DSH_SHIM, args, {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env },
  });
  const elapsedMs = Date.now() - started;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  out(`       $ dsh ${args.join(' ')}`);
  out(`         -> exit=${result.status}${result.error ? ` error=${result.error.code ?? result.error.message}` : ''} stdout=${stdout.length}B stderr=${stderr.length}B ${elapsedMs}ms  [${label}]`);
  return { status: result.status, signal: result.signal, error: result.error, stdout, stderr, elapsedMs };
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

out('== dsh-plugin-jev bundle-install verification harness ==');
out(`repo:      ${REPO}`);
out(`dsh home:  ${DSH_HOME}`);
out('');

// Snapshot BEFORE anything else runs (task-3 requirement 4, SPEC criterion 8).
const watchedBefore = {
  repoLib: fingerprint(REPO_LIB),
  repoPackage: fingerprint(REPO_PACKAGE_JSON),
  repoPatch: fingerprint(REPO_PATCH),
  webPatch: fingerprint(WEB_PATCH),
  webPackage: fingerprint(join(WEB_DIR, 'package.json')),
  webRoot: fingerprint(WEB_ROOT),
  headlessPatch: fingerprint(HEADLESS_PATCH),
};
out('-- pre-run fingerprints --');
for (const fp of Object.values(watchedBefore)) out(`   ${fingerprintLine(fp)}`);
out('');

// --- ENV -------------------------------------------------------------------
out('--- ENV: locate the real dsh installation ---');

const repoManifest = (() => {
  try {
    return JSON.parse(readFileSync(REPO_PACKAGE_JSON, 'utf8'));
  } catch {
    return undefined;
  }
})();
expectTrue('E.1', 'repo package.json parses as an object', repoManifest !== null && typeof repoManifest === 'object', `path: ${REPO_PACKAGE_JSON}`);

const DSH_SHIM = findOnPath('dsh');
expectTrue('E.2', 'dsh shim is on PATH', DSH_SHIM !== undefined, `PATH=${process.env.PATH}`);

let DSH_PKG;
if (DSH_SHIM !== undefined) {
  const target = shimTarget(DSH_SHIM);
  if (target !== undefined && existsSync(target)) {
    DSH_PKG = realpathSync(dirname(dirname(target)));
    expectTrue('E.3', 'dsh package directory resolved from the shim target', existsSync(join(DSH_PKG, 'package.json')), `shim=${DSH_SHIM}\ntarget=${target}\npackageDir=${DSH_PKG}`);
  } else {
    fail('E.3', 'dsh package directory resolved from the shim target', `could not read a cmd-shim target from ${DSH_SHIM}`);
  }
} else {
  // SKIP semantics: the prerequisite (a dsh installation) is absent, so this
  // assertion cannot be evaluated at all. A SKIP never turns the suite green:
  // E.2 (and every dsh-dependent check below) FAILs, so the run exits non-zero.
  skip('E.3', 'dsh package directory resolved from the shim target', 'not evaluated: dsh shim not on PATH (E.2 failed)');
}

let bundleManifest;
let resolveBundleDir;
let loadOverlayPatches;
let pmOpsPath;
let appBootPath;

if (DSH_PKG !== undefined) {
  const requireFromDsh = createRequire(join(DSH_PKG, 'lib', 'bin.js'));
  try {
    pmOpsPath = requireFromDsh.resolve('@deepseek-ai/dsh-plugin-manager/operations');
    const ops = await import(pathToFileURL(pmOpsPath).href);
    bundleManifest = ops.bundleManifest;
    expectTrue('E.4', 'plugin-manager operations.bundleManifest is a function (real code path)', typeof bundleManifest === 'function', `module: ${pmOpsPath}`);
  } catch (error) {
    fail('E.4', 'plugin-manager operations.bundleManifest is a function (real code path)', `resolve/import failed: ${error?.stack ?? error}`);
  }
  try {
    appBootPath = requireFromDsh.resolve('@deepseek-ai/dsh-app-boot');
    const appBoot = await import(pathToFileURL(appBootPath).href);
    resolveBundleDir = appBoot.resolveBundleDir;
    loadOverlayPatches = appBoot.loadOverlayPatches;
    expectTrue('E.5', 'dsh-app-boot exposes resolveBundleDir + loadOverlayPatches', typeof resolveBundleDir === 'function' && typeof loadOverlayPatches === 'function', `module: ${appBootPath}`);
  } catch (error) {
    fail('E.5', 'dsh-app-boot exposes resolveBundleDir + loadOverlayPatches', `resolve/import failed: ${error?.stack ?? error}`);
  }
} else {
  skip('E.4', 'plugin-manager operations.bundleManifest is a function (real code path)', 'not evaluated: dsh installation unresolved (E.3 failed)');
  skip('E.5', 'dsh-app-boot exposes resolveBundleDir + loadOverlayPatches', 'not evaluated: dsh installation unresolved (E.3 failed)');
}

// ---------------------------------------------------------------------------
// fixtures (all inside our own mkdtemp directory)
// ---------------------------------------------------------------------------

const workRoot = mkdtempSync(join(tmpdir(), 'dsh-bundle-verify-'));
out('');
out(`-- scratch root -- ${workRoot}`);
out('');

/** A realistic package-install layout: package.json + dsh.patch.yml + lib/index.js. */
function makePackageCopy(destDir, { stripDshField = false } = {}) {
  mkdirSync(destDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(REPO_PACKAGE_JSON, 'utf8'));
  if (stripDshField) delete manifest.dsh;
  writeFileSync(join(destDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`);
  cpSync(REPO_PATCH, join(destDir, 'dsh.patch.yml'));
  cpSync(join(REPO, 'lib'), join(destDir, 'lib'), { recursive: true });
  return destDir;
}

/** A profile-like directory whose node_modules/<name> is a symlink to pkgDir. */
function makeProfileWithLink(profileDir, pkgDir) {
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true });
  symlinkSync(pkgDir, join(profileDir, 'node_modules', 'dsh-plugin-jev'), 'dir');
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify({ name: 'fake-profile', private: true, dependencies: { 'dsh-plugin-jev': 'link:' } }, undefined, 2)}\n`,
  );
  return profileDir;
}

const posProfile = makeProfileWithLink(join(workRoot, 'pos-profile'), REPO);
const negPkg = makePackageCopy(join(workRoot, 'neg-package'), { stripDshField: true });
const negProfile = makeProfileWithLink(join(workRoot, 'neg-profile'), negPkg);
const installedPkg = makePackageCopy(join(workRoot, 'installed', 'node_modules', 'dsh-plugin-jev'));

// ---------------------------------------------------------------------------
// SECTION 1 — bundleManifest through the real plugin-manager code path
//             (SPEC criterion 2 / task-3 requirement 1)
// ---------------------------------------------------------------------------

out('--- SECTION 1: bundleManifest real code path ---');

const posLink = join(posProfile, 'node_modules', 'dsh-plugin-jev');
let isLink = false;
try {
  isLink = lstatSync(posLink).isSymbolicLink();
} catch {
  isLink = false;
}
expectTrue('1.1', 'positive fixture node_modules/dsh-plugin-jev is a symlink', isLink, `path: ${posLink}`);

const anchor = DSH_PKG === undefined ? undefined : join(DSH_PKG, 'package.json');

let posResolvedDir;
if (resolveBundleDir !== undefined && anchor !== undefined) {
  try {
    posResolvedDir = resolveBundleDir('dsh', 'dsh-plugin-jev', anchor, posProfile);
    expectEq('1.2', 'resolveBundleDir resolves the symlinked package under the fake profile', realpathSync(posResolvedDir), realpathSync(REPO), `anchor=${anchor}\nprofileDir=${posProfile}`);
  } catch (error) {
    fail('1.2', 'resolveBundleDir resolves the symlinked package under the fake profile', `${error?.message ?? error}`);
  }
} else {
  skip('1.2', 'resolveBundleDir resolves the symlinked package under the fake profile', 'not evaluated: dsh-app-boot did not load (E.5 failed)');
}

// Independent raw read of the repo manifest — proves the dsh field exists
// without going through bundleManifest.
const repoDeclaredPatch = repoManifest?.dsh?.bundle?.patch;
expectEq('1.3', "repo package.json declares dsh.bundle.patch === './dsh.patch.yml'", repoDeclaredPatch, './dsh.patch.yml', `repo manifest: ${REPO_PACKAGE_JSON}`);

let posManifest;
if (typeof bundleManifest === 'function' && anchor !== undefined) {
  try {
    posManifest = bundleManifest('dsh-plugin-jev', posProfile, anchor);
    expectTrue('1.4', 'bundleManifest(name, posProfile, anchor) returns a manifest (not undefined)', posManifest !== undefined, `resolvedDir=${posResolvedDir}\nmanifest.dsh=${JSON.stringify(posManifest?.dsh)}`);
    if (posManifest !== undefined) {
      expectEq('1.5', "returned manifest.dsh.bundle.patch === './dsh.patch.yml'", posManifest?.dsh?.bundle?.patch, './dsh.patch.yml');
      expectEq('1.6', 'returned manifest identifies the package as dsh-plugin-jev', posManifest?.name, 'dsh-plugin-jev');
    } else {
      fail('1.5', "returned manifest.dsh.bundle.patch === './dsh.patch.yml'", 'not evaluated: bundleManifest returned undefined (assertion 1.4 failed)');
      fail('1.6', 'returned manifest identifies the package as dsh-plugin-jev', 'not evaluated: bundleManifest returned undefined (assertion 1.4 failed)');
    }
  } catch (error) {
    fail('1.4', 'bundleManifest(name, posProfile, anchor) returns a manifest (not undefined)', `${error?.stack ?? error}`);
    fail('1.5', "returned manifest.dsh.bundle.patch === './dsh.patch.yml'", 'not evaluated: bundleManifest threw (assertion 1.4 failed)');
    fail('1.6', 'returned manifest identifies the package as dsh-plugin-jev', 'not evaluated: bundleManifest threw (assertion 1.4 failed)');
  }
} else {
  const why = typeof bundleManifest !== 'function' ? 'plugin-manager operations did not load (E.4 failed)' : 'dsh installation anchor unresolved (E.3 failed)';
  fail('1.4', 'bundleManifest(name, posProfile, anchor) returns a manifest (not undefined)', `not evaluated: ${why}`);
  fail('1.5', "returned manifest.dsh.bundle.patch === './dsh.patch.yml'", `not evaluated: ${why}`);
  fail('1.6', 'returned manifest identifies the package as dsh-plugin-jev', `not evaluated: ${why}`);
}

// Negative fixture: same layout, package copy with the dsh field deleted.
const negManifestRaw = JSON.parse(readFileSync(join(negPkg, 'package.json'), 'utf8'));
expectTrue('1.7', "negative fixture package.json has no 'dsh' key", negManifestRaw.dsh === undefined, `path: ${join(negPkg, 'package.json')}`);

if (resolveBundleDir !== undefined && anchor !== undefined) {
  try {
    const negResolvedDir = resolveBundleDir('dsh', 'dsh-plugin-jev', anchor, negProfile);
    pass('1.8', 'negative fixture package still RESOLVES (so undefined below is a missing-field result, not a resolution failure)', `resolvedDir=${negResolvedDir}`);
  } catch (error) {
    fail('1.8', 'negative fixture package still RESOLVES (so undefined below is a missing-field result, not a resolution failure)', `${error?.message ?? error}`);
  }
} else {
  skip('1.8', 'negative fixture package still RESOLVES (so undefined below is a missing-field result, not a resolution failure)', 'not evaluated: dsh-app-boot did not load (E.5 failed)');
}

if (typeof bundleManifest === 'function' && anchor !== undefined) {
  try {
    const negResult = bundleManifest('dsh-plugin-jev', negProfile, anchor);
    expectTrue('1.9', 'bundleManifest(name, negProfile, anchor) returns undefined for a package without dsh.bundle', negResult === undefined, `actual=${JSON.stringify(negResult?.dsh)}`);
  } catch (error) {
    fail('1.9', 'bundleManifest(name, negProfile, anchor) returns undefined for a package without dsh.bundle', `${error?.stack ?? error}`);
  }
} else {
  fail('1.9', 'bundleManifest(name, negProfile, anchor) returns undefined for a package without dsh.bundle', 'not evaluated: plugin-manager operations unavailable (E.3/E.4 failed)');
}

// ---------------------------------------------------------------------------
// SECTION 2 — relative patch name resolves beside the patch file, i.e. inside
//             the installed package (task-3 requirement 2 / SPEC criterion 3)
// ---------------------------------------------------------------------------

out('');
out('--- SECTION 2: relative name resolves inside the package-install layout ---');

const installedPatch = join(installedPkg, 'dsh.patch.yml');
const installedLibExpected = pathToFileURL(join(installedPkg, 'lib', 'index.js')).href;
expectTrue(
  '2.1',
  'installed-layout fixture has dsh.patch.yml and lib/index.js side by side',
  existsSync(installedPatch) && existsSync(join(installedPkg, 'lib', 'index.js')),
  `patch=${installedPatch}\nlib=${join(installedPkg, 'lib', 'index.js')}`,
);

// 2.2 — same loader helper dsh itself uses for bundle layers.
if (typeof loadOverlayPatches === 'function') {
  try {
    const patches = loadOverlayPatches('dsh', installedPatch);
    const inserted = patches?.[0]?.insert?.[0];
    expectEq('2.2', 'loadOverlayPatches anchors the relative name to <pkg>/lib/index.js', inserted?.name, installedLibExpected, `patches=${JSON.stringify(patches)}`);
  } catch (error) {
    fail('2.2', 'loadOverlayPatches anchors the relative name to <pkg>/lib/index.js', `${error?.stack ?? error}`);
  }
} else {
  fail('2.2', 'loadOverlayPatches anchors the relative name to <pkg>/lib/index.js', 'not evaluated: dsh-app-boot did not load (E.5 failed)');
}

let cliLay = { status: undefined, stdout: '', stderr: '' };
if (DSH_SHIM !== undefined) {
  cliLay = runDsh(['--profile', 'headless', '--patch', installedPatch, '--dump-config'], 'section2: bundle-layer resolution');
  expectEq('2.3', 'dsh --profile headless --patch <pkg>/dsh.patch.yml --dump-config exits 0', cliLay.status, 0, `stderr(first 800B)=${cliLay.stderr.slice(0, 800)}`);
  expectTrue('2.4', 'dump-config resolves the insert name to the package-internal lib/index.js', cliLay.stdout.includes(installedLibExpected), `wanted substring: ${installedLibExpected}\nstdout(first 400B of matches)=${(cliLay.stdout.match(/file:[^\s]*/g) ?? []).slice(0, 5).join('\n')}`);
  expectTrue('2.5', 'dump-config records the bundle-layer source file', cliLay.stdout.includes(`# == ${installedPatch}`), `wanted: "# == ${installedPatch}"`);
  expectEq('2.6', 'a single clean bundle layer inserts id tool-jev exactly once', countHits(cliLay.stdout, 'id: tool-jev'), 1);
  expectTrue('2.7', "the resolved URL is the fixture's copy, NOT the repository path", !cliLay.stdout.includes(pathToFileURL(REPO_LIB).href), `repo URL that must be absent: ${pathToFileURL(REPO_LIB).href}`);
} else {
  for (const id of ['2.3', '2.4', '2.5', '2.6', '2.7']) {
    fail(id, 'dump-config evidence for the package-install layout', 'not evaluated: dsh shim not found on PATH (E.2 failed)');
  }
}

// ---------------------------------------------------------------------------
// SECTION 3 — two same-id insert rows coexist (task-3 requirement 3)
//             => migrating to the bundle layer REQUIRES deleting the old row
// ---------------------------------------------------------------------------

out('');
out('--- SECTION 3: duplicate id: tool-jev rows coexist ---');

const dupDir = join(workRoot, 'dup-layer');
mkdirSync(join(dupDir, 'lib'), { recursive: true });
cpSync(REPO_LIB, join(dupDir, 'lib', 'index.js'));
const dupPatch = join(dupDir, 'dsh.patch.yml');
writeFileSync(
  dupPatch,
  [
    '# Absolute-path row: the pre-existing user-layer style.',
    '- insert:',
    '    - id: tool-jev',
    `      name: '${REPO_LIB}'`,
    '      config:',
    '        transport: typesafe',
    '# Relative row: the new bundle-layer style.',
    '- insert:',
    '    - id: tool-jev',
    "      name: './lib/index.js'",
    '      config:',
    '        transport: typesafe',
    '',
  ].join('\n'),
);

const dupText = readFileSync(dupPatch, 'utf8');
expectTrue(
  '3.1',
  'duplicate fixture carries one absolute-name row and one relative-name row, both id tool-jev',
  countHits(dupText, 'id: tool-jev') === 2 && dupText.includes(`name: '${REPO_LIB}'`) && dupText.includes("name: './lib/index.js'"),
  `fixture:\n${dupText}`,
);

if (DSH_SHIM !== undefined) {
  const dupDump = runDsh(['--profile', 'headless', '--patch', dupPatch, '--dump-config'], 'section3: isolated duplicate');
  expectEq('3.2a', 'isolated dump-config over the duplicate patch exits 0', dupDump.status, 0, `stderr(first 800B)=${dupDump.stderr.slice(0, 800)}`);
  expectEq('3.2b', 'isolated dump-config contains exactly two id: tool-jev rows', countHits(dupDump.stdout, 'id: tool-jev'), 2);
  const urls = (dupDump.stdout.match(/file:[^\s]*lib\/index\.js/g) ?? []).map((u) => u.replace(/^-+/, ''));
  expectTrue(
    '3.3',
    'the two rows resolve to two DIFFERENT plugin paths (repo abs vs patch-relative)',
    new Set(urls).size === 2 && urls.includes(pathToFileURL(join(dupDir, 'lib', 'index.js')).href),
    `urls=${JSON.stringify(urls)}`,
  );

  // 3.4-3.7 — the real migration scenario: web's user layer already holds the
  // absolute repo row, and a bundle layer adds the relative row.
  const webBaseline = runDsh(['--profile', 'web', '--dump-config'], 'section3: web baseline');
  const webPatched = runDsh(['--profile', 'web', '--patch', installedPatch, '--dump-config'], 'section3: web + bundle layer');
  expectEq('3.4', 'dsh --profile web --patch <pkg>/dsh.patch.yml --dump-config exits 0', webPatched.status, 0, `stderr(first 800B)=${webPatched.stderr.slice(0, 800)}`);
  const baselineRows = countHits(webBaseline.stdout, 'id: tool-jev');
  const patchedRows = countHits(webPatched.stdout, 'id: tool-jev');
  out(`       web baseline rows=${baselineRows}  web+bundle rows=${patchedRows}`);
  expectEq('3.5', 'the bundle layer adds exactly one more id: tool-jev row on top of the web user layer', patchedRows, baselineRows + 1);
  expectTrue('3.6', 'two same-id rows therefore coexist (>= 2), so the old user-layer row MUST be deleted before switching', patchedRows >= 2, `baseline=${baselineRows} patched=${patchedRows}`);
  expectTrue('3.7', 'the added row is the bundle layer resolving inside the installed package', webPatched.stdout.includes(installedLibExpected), `wanted: ${installedLibExpected}`);
} else {
  for (const id of ['3.2a', '3.2b', '3.3', '3.4', '3.5', '3.6', '3.7']) {
    fail(id, 'duplicate-row evidence from dump-config', 'not evaluated: dsh shim not found on PATH (E.2 failed)');
  }
}

// ---------------------------------------------------------------------------
// SECTION 4 — nothing outside the scratch dir was modified
//             (task-3 requirement 4 / SPEC criterion 8)
// ---------------------------------------------------------------------------

out('');
out('--- SECTION 4: repository + live profile untouched ---');

const watchedAfter = {
  repoLib: fingerprint(REPO_LIB),
  repoPackage: fingerprint(REPO_PACKAGE_JSON),
  repoPatch: fingerprint(REPO_PATCH),
  webPatch: fingerprint(WEB_PATCH),
  webPackage: fingerprint(join(WEB_DIR, 'package.json')),
  webRoot: fingerprint(WEB_ROOT),
  headlessPatch: fingerprint(HEADLESS_PATCH),
};

out('-- post-run fingerprints --');
for (const fp of Object.values(watchedAfter)) out(`   ${fingerprintLine(fp)}`);

expectTrue('4.1a', 'repo lib/index.js content hash unchanged', watchedBefore.repoLib.exists && watchedBefore.repoLib.hash === watchedAfter.repoLib.hash, `${fingerprintLine(watchedBefore.repoLib)}\n${fingerprintLine(watchedAfter.repoLib)}`);
expectTrue('4.1b', 'repo lib/index.js mtime unchanged', fingerprintsEqual(watchedBefore.repoLib, watchedAfter.repoLib), `${fingerprintLine(watchedBefore.repoLib)}\n${fingerprintLine(watchedAfter.repoLib)}`);

expectTrue('4.2a', '~/.dsh/profiles/web/cordis.patch.yml content hash unchanged', watchedBefore.webPatch.exists && watchedBefore.webPatch.hash === watchedAfter.webPatch.hash, `${fingerprintLine(watchedBefore.webPatch)}\n${fingerprintLine(watchedAfter.webPatch)}`);
expectTrue('4.2b', '~/.dsh/profiles/web/cordis.patch.yml mtime unchanged', fingerprintsEqual(watchedBefore.webPatch, watchedAfter.webPatch), `${fingerprintLine(watchedBefore.webPatch)}\n${fingerprintLine(watchedAfter.webPatch)}`);

expectTrue('4.3', '~/.dsh/profiles/web/package.json hash + mtime unchanged', fingerprintsEqual(watchedBefore.webPackage, watchedAfter.webPackage), `${fingerprintLine(watchedBefore.webPackage)}\n${fingerprintLine(watchedAfter.webPackage)}`);

expectTrue('4.4', 'repo package.json AND dsh.patch.yml hashes unchanged (harness mutated no repo file)', watchedBefore.repoPackage.hash === watchedAfter.repoPackage.hash && watchedBefore.repoPatch.hash === watchedAfter.repoPatch.hash, `${fingerprintLine(watchedBefore.repoPackage)}\n${fingerprintLine(watchedAfter.repoPackage)}\n${fingerprintLine(watchedBefore.repoPatch)}\n${fingerprintLine(watchedAfter.repoPatch)}`);

// cordis.yml is machine-managed: dsh rewrites the canonical empty root on every
// profile load, so only the CONTENT is asserted. The mtime drift is reported.
const webRootContent = existsSync(WEB_ROOT) ? readFileSync(WEB_ROOT, 'utf8') : undefined;
expectTrue('4.5a', 'web/cordis.yml content is still the canonical empty root (content hash unchanged, may be rewritten byte-identically)', watchedBefore.webRoot.exists && watchedBefore.webRoot.hash === watchedAfter.webRoot.hash && webRootContent === CANONICAL_EMPTY_ROOT, `${fingerprintLine(watchedBefore.webRoot)}\n${fingerprintLine(watchedAfter.webRoot)}\ncontent=${JSON.stringify(webRootContent)}`);
out(`       note: web/cordis.yml mtime ${watchedBefore.webRoot.mtimeMs} -> ${watchedAfter.webRoot.mtimeMs} (dsh always rewrites this machine-managed root; content is identical)`);

const headlessContent = existsSync(HEADLESS_PATCH) ? readFileSync(HEADLESS_PATCH, 'utf8') : undefined;
expectTrue('4.6', 'headless profile patch layer is still empty (harness left it untouched)', typeof headlessContent === 'string' && /^\s*(#[^\n]*\n)*\[\]\s*$/.test(headlessContent), `content=${JSON.stringify(headlessContent)}`);

// ---------------------------------------------------------------------------
// summary + cleanup
// ---------------------------------------------------------------------------

out('');
out('== summary ==');
out(`PASS=${passed} FAIL=${failed} SKIP=${skipped}`);
if (failures.length > 0) {
  out('failures:');
  for (const f of failures) out(`  - ${f}`);
}

if (process.env.KEEP_TMP === '1') {
  out(`kept scratch dir: ${workRoot}`);
} else {
  try {
    rmSync(workRoot, { recursive: true, force: true });
    out(`cleaned scratch dir: ${workRoot}`);
  } catch (error) {
    out(`WARNING: could not remove scratch dir ${workRoot}: ${error?.message ?? error}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
