/**
 * Preset half tests.
 *
 * `lib/tools.js` is the plugin the `spec` Agent preset mounts. Because it
 * registers into the calling (preset) Cordis scope, the isolation the whole
 * design rests on is structural: the host row registers nothing, and this
 * module registers everything. These assertions pin that module's own contract:
 * the eight tools, the two prompt contributions, live settings, and disposal.
 *
 * Run: node --test test/tools.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const home = await mkdtemp(path.join(tmpdir(), 'dsh-spec-tools-home-'));
process.env.DSH_HOME = home;
const workspace = await mkdtemp(path.join(tmpdir(), 'dsh-spec-tools-ws-'));

const { apply, name, inject, SPEC_POLICY_TEXT } = await import('../lib/tools.js');
const { TOOL_NAMES, DEFAULT_SETTINGS } = await import('../lib/constants.js');

const settingsFile = path.join(home, 'spec', 'settings.json');

/** Write the settings file the way the Web panel's saveSettings does. */
async function saveSettings(values) {
  await mkdir(path.dirname(settingsFile), { recursive: true });
  await writeFile(settingsFile, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
}

async function clearSettings() {
  await rm(settingsFile, { force: true });
}

/** A preset-scope context that records registrations and their disposers. */
function makeScope(options = {}) {
  const tools = new Map();
  const sections = [];
  const contexts = [];
  const toolDisposers = [];
  const sectionDisposers = [];
  const contextDisposers = [];
  const disposeListeners = [];
  const ctx = {
    tools: {
      register: (definition) => {
        tools.set(definition.name, definition);
        const disposer = () => tools.delete(definition.name);
        toolDisposers.push(disposer);
        return disposer;
      },
    },
    get: options.get ?? ((key) => (key === 'systemPrompt'
      ? {
        section: (section) => {
          sections.push(section);
          const disposer = () => sections.splice(sections.indexOf(section), 1);
          sectionDisposers.push(disposer);
          return disposer;
        },
        context: (context) => {
          contexts.push(context);
          const disposer = () => contexts.splice(contexts.indexOf(context), 1);
          contextDisposers.push(disposer);
          return disposer;
        },
      }
      : key === 'workspaceRegistry' ? { list: () => [{ path: workspace }] } : undefined)),
    on: (event, listener) => {
      if (event === 'dispose') disposeListeners.push(listener);
    },
    inject: () => {},
    logger: { warn: () => {} },
  };
  apply(ctx, options.config ?? {});
  return {
    tools,
    sections,
    contexts,
    disposeListeners,
    async dispose() {
      for (const listener of disposeListeners) await listener();
    },
  };
}

test('the preset entry declares its own identity and the one service it needs', () => {
  assert.equal(name, '@weniatall/dsh-spec/tools');
  assert.deepEqual(inject, ['tools']);
});

test('all eight spec tools register in the preset scope', () => {
  const scope = makeScope();
  assert.deepEqual([...scope.tools.keys()].sort(), Object.values(TOOL_NAMES).sort());
  assert.equal(scope.tools.size, 8);
});

test('the tools carry schemas the model can call', () => {
  const scope = makeScope();
  for (const [toolName, definition] of scope.tools) {
    assert.equal(typeof definition.description, 'string', `${toolName} needs a description`);
    assert.ok(definition.description.length > 20, `${toolName} description is too thin`);
    assert.equal(definition.parameters?.type, 'object', `${toolName} needs an object schema`);
    assert.equal(typeof definition.execute, 'function', `${toolName} needs an execute function`);
  }
});

test('the policy section and the active-spec context register with their orders', () => {
  const scope = makeScope();
  assert.deepEqual(scope.sections.map((entry) => entry.name), ['spec-policy']);
  assert.deepEqual(scope.contexts.map((entry) => entry.name), ['spec-active']);
  assert.equal(scope.sections[0].order, 185);
  assert.equal(scope.sections[0].interpolate, false);
  assert.equal(scope.contexts[0].order, 650);
});

test('the policy text carries the Kiro contract the model must follow', () => {
  assert.match(SPEC_POLICY_TEXT, /requirements\.md/u);
  assert.match(SPEC_POLICY_TEXT, /Correctness Properties/u);
  assert.match(SPEC_POLICY_TEXT, /Task Dependency Graph/u);
  for (const status of ['[ ]', '[~]', '[-]', '[x]']) {
    assert.ok(SPEC_POLICY_TEXT.includes(status), `missing status ${status}`);
  }
  assert.match(SPEC_POLICY_TEXT, /spec_task_update/u);
  assert.match(SPEC_POLICY_TEXT, /spec_check/u);
});

test('the policy section text is a function so settings reach the next assembly', async () => {
  const scope = makeScope();
  const section = scope.sections[0];
  assert.equal(typeof section.text, 'function');
  await clearSettings();
  assert.equal(section.text({}).length > 0, true, 'defaults keep the policy on');
});

test('disabling the prompt setting empties the policy section without a remount', async () => {
  await clearSettings();
  const scope = makeScope();
  const section = scope.sections[0];
  assert.ok(section.text({}).length > 0);

  await saveSettings({ promptEnabled: false });
  assert.equal(section.text({}), '', 'the rendered section must be empty');

  await saveSettings({ promptEnabled: true });
  assert.ok(section.text({}).length > 0, 're-enabling restores the section');

  await clearSettings();
});

test('the active-spec context honours its own switch and its limit', async () => {
  await clearSettings();
  // One spec on disk so the provider has something to report.
  const specDir = path.join(workspace, '.kiro', 'specs', 'alpha');
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, '.config.kiro'), JSON.stringify({ specType: 'feature', workflowType: 'requirements-first' }));
  await writeFile(path.join(specDir, 'tasks.md'), `# Implementation Plan: Alpha

## Overview

x

## Tasks

- [ ] 1. Do the thing
  - _Requirements: 1.1_

## Notes

x

## Task Dependency Graph

\`\`\`json
{ "waves": [{ "id": 0, "tasks": ["1"] }] }
\`\`\`
`);

  const scope = makeScope();
  const provider = scope.contexts[0].text;
  const withDefault = provider({ agent: { session: { header: { cwd: workspace } } } });
  assert.match(withDefault, /alpha/u);
  assert.match(withDefault, /Specs in this workspace/u);

  await saveSettings({ includeActiveSpecs: false });
  assert.equal(provider({ agent: { session: { header: { cwd: workspace } } } }), '');

  await saveSettings({ includeActiveSpecs: true, promptMaxSpecs: 0 });
  assert.equal(provider({ agent: { session: { header: { cwd: workspace } } } }), '');

  await saveSettings({ includeActiveSpecs: true, promptMaxSpecs: 5 });
  assert.match(provider({ agent: { session: { header: { cwd: workspace } } } }), /alpha/u);

  await clearSettings();
});

test('the context reports nothing for a workspace with no specs', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'dsh-spec-empty-'));
  const scope = makeScope();
  const provider = scope.contexts[0].text;
  assert.equal(provider({ agent: { session: { header: { cwd: empty } } } }), '');
});

test('profile config and the saved file both feed the prompt switches', async () => {
  await clearSettings();
  const scope = makeScope({ config: { prompt: { enabled: false } } });
  const section = scope.sections[0];
  assert.equal(section.text({}), '', 'profile config disables the policy');

  // The settings file wins over the profile config, as it always has.
  await saveSettings({ promptEnabled: true });
  assert.ok(section.text({}).length > 0);
  await clearSettings();
});

test('a preset scope without a prompt service still gets the tools', () => {
  const tools = new Map();
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    get: () => undefined,
    inject: () => {},
    on: () => {},
    logger: { warn: () => {} },
  };
  apply(ctx, {});
  assert.equal(tools.size, 8, 'tools load without systemPrompt');
});

test('disposing the preset scope releases every contribution', async () => {
  const scope = makeScope();
  assert.equal(scope.tools.size, 8);
  assert.equal(scope.sections.length, 1);
  assert.equal(scope.contexts.length, 1);
  await scope.dispose();
  assert.equal(scope.tools.size, 0, 'tools must be unregistered');
  assert.equal(scope.sections.length, 0, 'policy section must be released');
  assert.equal(scope.contexts.length, 0, 'runtime context must be released');
});

test('the tools execute against the workspace once registered', async () => {
  const scope = makeScope();
  const exec = {
    agent: { id: 'sess-1', session: { id: 'sess-1', header: { cwd: workspace } } },
    callId: 'call-1',
    signal: new AbortController().signal,
  };
  const created = await scope.tools.get(TOOL_NAMES.create).execute({ title: 'Preset Created Spec' }, exec);
  assert.equal(created.feature, 'preset-created-spec');
  const listed = await scope.tools.get(TOOL_NAMES.list).execute({}, exec);
  assert.ok(listed.specs.some((spec) => spec.feature === 'preset-created-spec'));
  // The skeleton the preset asked for is the Kiro one.
  const requirements = await readFile(path.join(workspace, '.kiro', 'specs', 'preset-created-spec', 'requirements.md'), 'utf8');
  assert.match(requirements, /^# Requirements Document/u);
});

test('the default settings constant still describes the shipped defaults', () => {
  assert.equal(DEFAULT_SETTINGS.kiroDir, '.kiro');
  assert.equal(DEFAULT_SETTINGS.promptEnabled, true);
  assert.equal(DEFAULT_SETTINGS.includeActiveSpecs, true);
  assert.equal(DEFAULT_SETTINGS.promptMaxSpecs, 5);
  assert.equal(DEFAULT_SETTINGS.defaultSpecType, 'feature');
  assert.equal(DEFAULT_SETTINGS.defaultWorkflow, 'requirements-first');
});

test('the policy section tells the Agent which language to write the documents in', async () => {
  await clearSettings();
  const scope = makeScope();
  const section = scope.sections[0];
  // An explicit setting pins the language, which is the escape hatch when the
  // OS language is not the language the specs are written in.
  await saveSettings({ language: 'zh' });
  const chinese = section.text({});
  assert.match(chinese, /Simplified Chinese/u);
  assert.match(chinese, /Acceptance Criteria/u, 'the skeleton stays English');
  await saveSettings({ language: 'en' });
  const english = section.text({});
  assert.match(english, /Write all spec prose in English/u);
  assert.doesNotMatch(english, /Simplified Chinese/u);
  // Follow DSH (the default) still produces exactly one language line: never
  // both, which would leave the model to pick.
  await saveSettings({ language: '' });
  const following = section.text({});
  const saysChinese = /Simplified Chinese/u.test(following);
  const saysEnglish = /Write all spec prose in English/u.test(following);
  assert.notEqual(saysChinese, saysEnglish, 'exactly one language instruction');
  await clearSettings();
});
