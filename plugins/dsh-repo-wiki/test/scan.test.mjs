/**
 * Scanning, globbing and scope tests.
 *
 * The glob engine is the part a user notices when it is wrong — an `exclude`
 * that silently does nothing fills the wiki with test files. These tests pin
 * gitignore's actual semantics for the constructs `wiki_plan.yaml` uses, then
 * run the scope property over generated pattern sets.
 *
 * Run: node --test test/scan.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyScope,
  changedFiles,
  compileGitignore,
  compileGlob,
  headCommit,
  isAncestor,
  isGitRepo,
  isGitignored,
  isIgnoredPath,
  listRepoFiles,
  normalizeRelPath,
  readTextFile,
  renderTreeDigest,
  wikiExists,
} from '../lib/scan.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------------- *
 * Glob semantics
 * ------------------------------------------------------------------------- */

test('a bare pattern matches a basename at any depth', () => {
  const match = compileGlob('*.md');
  assert.equal(match('README.md'), true);
  assert.equal(match('docs/readme.md'), true);
  assert.equal(match('src/a.ts'), false);
});

test('an anchored pattern only matches from the root', () => {
  const match = compileGlob('/README.md');
  assert.equal(match('README.md'), true);
  assert.equal(match('docs/README.md'), false);
});

test('** crosses directories, a single * does not', () => {
  const deep = compileGlob('src/**/*.ts');
  assert.equal(deep('src/a.ts'), true);
  assert.equal(deep('src/lib/b.ts'), true);
  assert.equal(deep('src/lib/deep/c.ts'), true);
  assert.equal(deep('other/a.ts'), false);

  const shallow = compileGlob('src/*.ts');
  assert.equal(shallow('src/a.ts'), true);
  assert.equal(shallow('src/lib/b.ts'), false);
});

test('a trailing slash matches directories and everything under them', () => {
  const match = compileGlob('build/');
  assert.equal(match('build'), true);
  assert.equal(match('build/output.js'), true);
  assert.equal(match('src/build.js'), false);
});

test('? and character classes work', () => {
  assert.equal(compileGlob('a?.ts')('ab.ts'), true);
  assert.equal(compileGlob('a?.ts')('abc.ts'), false);
  assert.equal(compileGlob('a[bc].ts')('ab.ts'), true);
  assert.equal(compileGlob('a[bc].ts')('ad.ts'), false);
  assert.equal(compileGlob('a[!bc].ts')('ad.ts'), true);
});

test('a pattern with no match returns false for everything', () => {
  assert.equal(compileGlob('')('a.ts'), false);
  assert.equal(compileGlob('   ')('a.ts'), false);
});

test('normalizeRelPath strips ./ and trailing slashes', () => {
  assert.equal(normalizeRelPath('./src/a.ts'), 'src/a.ts');
  assert.equal(normalizeRelPath('src\\a.ts'), 'src/a.ts');
  assert.equal(normalizeRelPath('src/'), 'src');
});

test('isIgnoredPath skips VCS, deps and binaries', () => {
  assert.equal(isIgnoredPath('node_modules/x/y.js'), true);
  assert.equal(isIgnoredPath('.git/config'), true);
  assert.equal(isIgnoredPath('src/logo.png'), true);
  assert.equal(isIgnoredPath('src/app.ts'), false);
  assert.equal(isIgnoredPath('.DS_Store'), true);
  assert.equal(isIgnoredPath('custom/skip/me.ts', ['skip']), true);
});

/* ------------------------------------------------------------------------- *
 * Scope filtering
 * ------------------------------------------------------------------------- */

const FILES = [
  'README.md',
  'src/app.ts',
  'src/lib/util.ts',
  'src/lib/deep/x.ts',
  'test/a.test.ts',
  'docs/readme.md',
];

test('include keeps only matching files', () => {
  assert.deepEqual(applyScope(FILES, { include: ['src/**'] }), ['src/app.ts', 'src/lib/util.ts', 'src/lib/deep/x.ts']);
});

test('exclude drops matching files', () => {
  assert.deepEqual(applyScope(FILES, { exclude: ['**/test/**'] }), [
    'README.md',
    'src/app.ts',
    'src/lib/util.ts',
    'src/lib/deep/x.ts',
    'docs/readme.md',
  ]);
});

test('include and exclude compose', () => {
  assert.deepEqual(applyScope(FILES, { include: ['src/**'], exclude: ['**/deep/**'] }), [
    'src/app.ts',
    'src/lib/util.ts',
  ]);
});

test('a negated include rescues a file', () => {
  assert.deepEqual(applyScope(FILES, { include: ['src/**', '!src/lib/**'] }), ['src/app.ts']);
});

test('an empty scope is a no-op', () => {
  assert.deepEqual(applyScope(FILES, {}), FILES);
  assert.deepEqual(applyScope(FILES, { include: [], exclude: [] }), FILES);
});

/* ------------------------------------------------------------------------- *
 * Property 6: scope filtering semantics.
 * ------------------------------------------------------------------------- */

test('Property 6: applyScope honours include, exclude and input order', () => {
  const random = mulberry32(0x2468);
  const candidates = [
    'src/a.ts', 'src/lib/b.ts', 'test/c.ts', 'docs/d.md', 'README.md',
    'src/deep/e.ts', 'lib/f.ts', 'test/deep/g.ts',
  ];
  const patterns = ['src/**', '**/deep/**', '*.md', 'test/**', 'lib/**'];

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const include = random() < 0.5 ? [patterns[Math.floor(random() * patterns.length)]] : [];
    const exclude = random() < 0.5 ? [patterns[Math.floor(random() * patterns.length)]] : [];
    const input = candidates.filter(() => random() < 0.7);
    const output = applyScope(input, { include, exclude });

    // Order is preserved.
    let cursor = -1;
    for (const file of output) {
      const at = input.indexOf(file);
      assert.ok(at > cursor, 'output must preserve input order');
      cursor = at;
    }

    // Every survivor matches at least one include, when includes are given.
    if (include.length > 0) {
      for (const file of output) {
        const matched = include.some((pattern) => compileGlob(pattern)(file));
        assert.ok(matched, `${file} survived without matching ${include.join(', ')}`);
      }
    }

    // No survivor matches a positive exclude.
    for (const file of output) {
      for (const pattern of exclude) {
        if (pattern.startsWith('!')) continue;
        assert.equal(compileGlob(pattern)(file), false, `${file} survived exclude ${pattern}`);
      }
    }

    // Nothing is invented.
    for (const file of output) assert.ok(input.includes(file));
  }
});

/* ------------------------------------------------------------------------- *
 * Filesystem
 * ------------------------------------------------------------------------- */

test('listRepoFiles skips ignored directories and the output directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rw-scan-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
  await mkdir(path.join(root, '.dsh', 'repowiki'), { recursive: true });
  await writeFile(path.join(root, 'README.md'), '# x');
  await writeFile(path.join(root, 'src', 'app.ts'), 'x');
  await writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'x');
  await writeFile(path.join(root, '.dsh', 'repowiki', 'page.md'), 'x');
  await writeFile(path.join(root, 'logo.png'), 'x');

  const { files, total, truncated } = await listRepoFiles(root, { dataDir: '.dsh', maxFiles: 100 });
  assert.deepEqual(files, ['README.md', 'src/app.ts']);
  assert.equal(total, 2);
  assert.equal(truncated, false);
});

test('compileGitignore honours negation and last-match-wins', () => {
  const rules = [{ base: '', matchers: compileGitignore('*.log\n!keep.log\n') }];
  assert.equal(isGitignored('a.log', rules), true);
  assert.equal(isGitignored('keep.log', rules), false);
  assert.equal(isGitignored('src/a.log', rules), true, 'a bare pattern matches at any depth');
});

test('a nested .gitignore only rules its own subtree', () => {
  const rules = [
    { base: '', matchers: compileGitignore('build/\n') },
    { base: 'src', matchers: compileGitignore('generated/\n') },
  ];
  assert.equal(isGitignored('build/out.js', rules), true);
  assert.equal(isGitignored('src/generated/x.js', rules), true);
  assert.equal(isGitignored('generated/x.js', rules), false, 'src/ rules do not reach the root');
  assert.equal(isGitignored('src/app.ts', rules), false);
});

test('listRepoFiles honours .gitignore files, including nested ones', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rw-ignore-'));
  await mkdir(path.join(root, 'src', 'generated'), { recursive: true });
  await mkdir(path.join(root, 'build'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), '*.log\nbuild/\n');
  await writeFile(path.join(root, 'src', '.gitignore'), 'generated/\n');
  await writeFile(path.join(root, 'src', 'app.ts'), 'x');
  await writeFile(path.join(root, 'src', 'generated', 'x.ts'), 'x');
  await writeFile(path.join(root, 'build', 'out.js'), 'x');
  await writeFile(path.join(root, 'debug.log'), 'x');
  await writeFile(path.join(root, 'README.md'), '# x');

  const { files, total } = await listRepoFiles(root, { dataDir: '.dsh', maxFiles: 100 });
  assert.deepEqual(files, ['.gitignore', 'README.md', 'src/.gitignore', 'src/app.ts']);
  assert.equal(total, files.length);
});

function gitCmd(workspace, args) {
  execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
}

test('isAncestor detects a rewritten (rebased) commit', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'rw-ancestor-'));
  try {
    gitCmd(root, ['init', '-q']);
  } catch {
    t.skip('git is not available');
    return;
  }
  gitCmd(root, ['config', 'user.email', 'test@example.com']);
  gitCmd(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'a.txt'), 'one');
  gitCmd(root, ['add', '-A']);
  gitCmd(root, ['commit', '-qm', 'first']);
  const first = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  await writeFile(path.join(root, 'a.txt'), 'two');
  gitCmd(root, ['commit', '-aqm', 'second']);
  const second = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  assert.equal(await isAncestor(root, first, second), true);
  assert.equal(await isAncestor(root, second, first), false);

  // Amending with a real change rewrites HEAD: the pre-amend commit is no
  // longer reachable (a no-change amend can keep the same SHA).
  await writeFile(path.join(root, 'a.txt'), 'three');
  gitCmd(root, ['commit', '-aq', '--amend', '--no-edit']);
  const amended = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(await isAncestor(root, second, amended), false);
  assert.equal(await isAncestor(root, first, amended), true, 'the untouched parent survives');
});

test('listRepoFiles reports truncation at the cap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rw-cap-'));
  for (let i = 0; i < 6; i += 1) await writeFile(path.join(root, `f${i}.ts`), 'x');
  const { files, total, truncated } = await listRepoFiles(root, { maxFiles: 3 });
  assert.equal(files.length, 3);
  assert.equal(total, 6);
  assert.equal(truncated, true);
});

test('wikiExists distinguishes a missing root from an empty one', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rw-exists-'));
  assert.equal(await wikiExists(root, '.dsh'), false);
  await mkdir(path.join(root, '.dsh', 'repowiki'), { recursive: true });
  assert.equal(await wikiExists(root, '.dsh'), true);
});

test('readTextFile refuses binaries and oversize files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rw-read-'));
  await writeFile(path.join(root, 'ok.txt'), 'hello');
  await writeFile(path.join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
  await writeFile(path.join(root, 'big.txt'), 'x'.repeat(100));
  assert.equal(await readTextFile(path.join(root, 'ok.txt')), 'hello');
  assert.equal(await readTextFile(path.join(root, 'bin.dat')), null);
  assert.equal(await readTextFile(path.join(root, 'big.txt'), 10), null);
  assert.equal(await readTextFile(path.join(root, 'missing.txt')), null);
});

test('renderTreeDigest summarises directories', () => {
  const digest = renderTreeDigest(['README.md', 'src/a.ts', 'src/b.ts']);
  assert.match(digest, /src\/ \(2\)/u);
  assert.match(digest, /README\.md/u);
  const capped = renderTreeDigest(
    Array.from({ length: 40 }, (_, i) => `dir${i}/f.ts`),
    { maxEntries: 5 },
  );
  assert.match(capped, /more director/u);
});

test('git helpers degrade to null outside a repository', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rw-nogit-'));
  assert.equal(await isGitRepo(root), false);
  assert.equal(await headCommit(root), null);
  assert.deepEqual(await changedFiles(root, 'abc', 'HEAD'), []);
});
