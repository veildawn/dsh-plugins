import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { authorPrompt, createWorkflowLibrary, launchPrompt, normalizeName, parseCommandInput } from '../lib/library.js';

const meta = { name: 'Code Review', description: 'review', phases: [{ title: 'Find' }, { title: 'Verify' }] };

async function setup() {
  const globalDir = await mkdtemp(path.join(tmpdir(), 'dwf-global-'));
  const cwd = await mkdtemp(path.join(tmpdir(), 'dwf-ws-'));
  return { library: createWorkflowLibrary({ globalDir, now: () => 42 }), cwd, globalDir };
}

test('names normalize to safe file stems', () => {
  assert.equal(normalizeName('Code Review'), 'code-review');
  assert.equal(normalizeName('../etc/passwd'), 'etc-passwd');
  assert.equal(normalizeName('审查项目问题'), '审查项目问题');
  assert.throws(() => normalizeName('***'));
});

test('save, list, get and delete across both scopes; project shadows global', async () => {
  const { library, cwd } = await setup();
  const project = await library.save({ meta, script: 'return 1', args: { path: 'src' } }, { scope: 'project', cwd, sourceRunId: 'r1' });
  assert.equal(project.name, 'code-review');
  assert.equal(project.path, path.join(cwd, '.dsh', 'workflows', 'code-review.json'));
  await library.save({ meta, script: 'return 2' }, { scope: 'global', cwd });

  const all = await library.list({ cwd });
  assert.deepEqual(all.map((wf) => wf.scope), ['project', 'global']);
  assert.deepEqual(all[0].phases, ['Find', 'Verify']);

  const shadowed = await library.get('code-review', { cwd });
  assert.equal(shadowed.scope, 'project');
  assert.equal(shadowed.script, 'return 1');
  assert.equal((await library.get('code-review', { scope: 'global', cwd })).script, 'return 2');

  assert.equal(await library.remove('code-review', { scope: 'project', cwd }), true);
  assert.equal((await library.get('code-review', { cwd })).scope, 'global');
  assert.equal(await library.remove('missing', { cwd }), false);
});

test('project scope without a workspace fails, global still lists', async () => {
  const { library } = await setup();
  await assert.rejects(library.save({ meta, script: 'x' }, { scope: 'project' }), /workspace/u);
  await library.save({ meta, script: 'x' }, { scope: 'global' });
  assert.equal((await library.list({})).length, 1);
});

test('args must be a small JSON object', async () => {
  const { library } = await setup();
  await assert.rejects(library.save({ meta, script: 'x', args: [1] }, { scope: 'global' }));
  await assert.rejects(library.save({ meta, script: 'x', args: { big: 'y'.repeat(5000) } }, { scope: 'global' }));
});

test('launch prompt carries the saved call verbatim with merged args', () => {
  const prompt = launchPrompt({ name: 'r', scope: 'global', meta: { name: 'r', description: 'd' }, script: 'return args', args: { a: 1, b: 2 } }, { b: 3 });
  const json = JSON.parse(prompt.slice(prompt.indexOf('```json') + 7, prompt.lastIndexOf('```')));
  assert.deepEqual(json, { meta: { name: 'r', description: 'd' }, script: 'return args', args: { a: 1, b: 3 } });
  assert.match(prompt, /`workflow` tool exactly once/u);
});

test('/workflow input grammar', () => {
  assert.deepEqual(parseCommandInput(''), { name: '', scope: undefined, args: undefined, text: '' });
  assert.deepEqual(parseCommandInput(' review --global {"x":1}'), { name: 'review', scope: 'global', args: { x: 1 }, text: 'review {"x":1}' });
  assert.equal(parseCommandInput('review').name, 'review');
  assert.equal(parseCommandInput('审查项目问题').name, '审查项目问题');
  // Free text is a task, not a saved name.
  const task = parseCommandInput('审查 项目 问题');
  assert.equal(task.name, '');
  assert.equal(task.text, '审查 项目 问题');
  assert.equal(parseCommandInput('review {bad').name, '');
});

test('author prompt asks for one workflow call with phases', () => {
  const prompt = authorPrompt('审查项目问题');
  assert.match(prompt, /审查项目问题/u);
  assert.match(prompt, /`workflow` tool exactly once/u);
  assert.match(prompt, /meta\.phases/u);
});
