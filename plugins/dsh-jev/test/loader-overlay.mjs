/**
 * Loader/overlay integration check: runs the real DSH CLI as
 *   dsh --profile web --patch <repo>/dsh.patch.yml --dump-config
 * and asserts that the overlay's relative './lib/index.js' is resolved to the
 * repository's absolute file URL and inserted as the tool-jev entry.
 *
 * This test needs a working `dsh` on PATH. When the CLI is unavailable it
 * prints SKIP and exits 0, so a machine without DSH never turns the suite red.
 * It is deliberately not part of `npm test`.
 *
 * Run: node test/loader-overlay.mjs   (exit 0 = pass or SKIP, 1 = fail)
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '..');
const patchPath = join(repoRoot, 'dsh.patch.yml');
const expectedName = pathToFileURL(join(repoRoot, 'lib', 'index.js')).href;
const DUMP_TIMEOUT_MS = 60000;

function run(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: DUMP_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function fail(label, extra) {
  console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  console.log('');
  console.log('LOADER FAILED: 1 check(s)');
  process.exit(1);
}

const version = run('dsh', ['--version']);
if (version.error && version.error.code === 'ENOENT') {
  console.log('SKIP dsh is not installed on PATH');
  process.exit(0);
}
if (version.error || version.status !== 0) {
  const detail = version.error ? version.error.message : String(version.stderr || '').trim();
  console.log('SKIP dsh --version did not run cleanly: ' + detail);
  process.exit(0);
}
console.log('dsh version: ' + String(version.stdout).trim());

const dump = run('dsh', ['--profile', 'web', '--patch', patchPath, '--dump-config']);
if (dump.error) {
  const code = dump.error.code ?? '';
  if (code === 'ETIMEDOUT') {
    fail('dsh --dump-config finishes within ' + DUMP_TIMEOUT_MS + ' ms', 'ETIMEDOUT');
  }
  fail('dsh --dump-config runs', dump.error.message);
}
if (dump.status !== 0) {
  fail('dsh --dump-config exits 0', 'status=' + dump.status + ' stderr=' + String(dump.stderr || '').trim().slice(0, 400));
}

const output = String(dump.stdout ?? '') + String(dump.stderr ?? '');
console.log('PASS dsh --dump-config exits 0');
if (!output.includes('tool-jev')) {
  fail('dump-config output contains tool-jev', output.slice(0, 400));
}
console.log('PASS dump-config output contains tool-jev');
if (!output.includes(expectedName)) {
  fail('tool-jev name resolves to ' + expectedName, output.slice(0, 400));
}
console.log('PASS tool-jev name resolves to ' + expectedName);

console.log('');
console.log('LOADER OK');
process.exit(0);
