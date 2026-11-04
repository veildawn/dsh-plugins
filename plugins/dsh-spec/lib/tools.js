/**
 * dsh-spec/tools — the preset half.
 *
 * This module is the plugin a `@deepseek-ai/dsh-agent-preset` row mounts as
 * `@weniatall/dsh-spec/tools`. Everything it registers lands in the preset's
 * Cordis scope, so only an Agent that selected the `spec` preset sees the eight
 * `spec_*` tools or the Kiro policy section. The host row deliberately
 * registers none of it.
 *
 * @module dsh-spec/tools
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from './constants.js?dsh-spec=0.8.2';
import { SPEC_TYPES, WORKFLOW_TYPES, specsRoot } from './model.js?dsh-spec=0.8.2';
import { parseTasks, readyTasks, taskProgress } from './tasks.js?dsh-spec=0.8.2';
import { profilePatchPath, settingsFilePath } from './store.js?dsh-spec=0.8.2';
import { TOOL_NAMES } from './constants.js?dsh-spec=0.8.2';
import { languageInstruction, readLocalePreference, resolveLanguage } from './language.js?dsh-spec=0.8.2';
import {
  checkSpecOp,
  configSettings,
  createSpec,
  listSpecsOp,
  nextOp,
  pbtOp,
  readSpecOp,
  sanitizeSettings,
  taskUpdateOp,
  workspaceFor,
  writeSpecOp,
} from './ops.js?dsh-spec=0.8.2';

/** Cordis plugin name; must match the preset row `name`. */
export const name = '@weniatall/dsh-spec/tools';

/** Tools are required; the prompt registry is looked up optionally. */
export const inject = ['tools'];


/* ------------------------------------------------------------------------- *
 * Tool schemas
 * ------------------------------------------------------------------------- */

const TEXT = { type: 'string' };
const INT = { type: 'integer' };
const NULLABLE_TEXT = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const ISSUE = {
  type: 'object',
  additionalProperties: true,
  required: ['severity', 'message'],
  properties: {
    severity: { type: 'string', enum: ['error', 'warning', 'info'] },
    message: { type: 'string' },
    rule: { type: 'string' },
    file: { type: 'string' },
    line: { type: 'number' },
    itemId: { type: 'string' },
  },
};
const NUMBER = { type: 'number' };
const COUNTS = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'warning', 'info'],
  properties: { error: NUMBER, warning: NUMBER, info: NUMBER },
};
const PROGRESS = {
  type: 'object',
  additionalProperties: true,
  required: ['total', 'leaves', 'required', 'completed', 'percent'],
  properties: {
    total: NUMBER, leaves: NUMBER, required: NUMBER, optional: NUMBER,
    completed: NUMBER, inProgress: NUMBER, queued: NUMBER, notStarted: NUMBER, percent: NUMBER,
  },
};
const NULLABLE_NUMBER = { oneOf: [{ type: 'number' }, { type: 'null' }] };
const TASK_BRIEF = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'title'],
  properties: { id: TEXT, title: TEXT, optional: { type: 'boolean' }, wave: NULLABLE_NUMBER, requirements: { type: 'array', items: TEXT } },
};
const SPEC_LIST_ENTRY = {
  type: 'object',
  additionalProperties: true,
  required: ['feature', 'specType', 'workflowType', 'phase', 'ok'],
  properties: {
    feature: TEXT,
    specType: TEXT,
    workflowType: TEXT,
    phase: TEXT,
    requirements: NUMBER,
    clauses: NUMBER,
    properties: NUMBER,
    progress: { oneOf: [PROGRESS, { type: 'null' }] },
    ready: { type: 'array', items: TASK_BRIEF },
    issues: COUNTS,
    ok: { type: 'boolean' },
  },
};

function textContent(text) {
  return [{ type: 'text', text }];
}

function renderIssues(issues, limit = 12) {
  return issues.slice(0, limit).map((issue) => `- [${issue.severity}] ${issue.rule === undefined ? '' : `${issue.rule}: `}${issue.message}${issue.file === undefined ? '' : ` (${issue.file}${issue.line === undefined || issue.line === 0 ? '' : `:${issue.line}`})`}`);
}

function renderCreate(value) {
  return [
    `Created spec "${value.feature}" at ${value.directory}`,
    `Type: ${value.specType} · workflow: ${value.workflowType} · phase: ${value.phase}`,
    `Files: ${value.files.join(', ')}`,
    `Next: write ${value.phase === 'requirements' ? 'requirements.md' : `${value.phase}.md`} with ${TOOL_NAMES.write}, then run ${TOOL_NAMES.check}.`,
    ...(value.issues.length === 0 ? [] : ['', 'Findings:', ...renderIssues(value.issues)]),
  ].join('\n');
}

function renderList(value) {
  if (value.specs.length === 0) {
    return `No specs in ${value.root}.\nCreate one with ${TOOL_NAMES.create} (title, optional specType/workflowType).`;
  }
  const lines = [`Specs in ${value.root}:`];
  for (const spec of value.specs) {
    const progress = spec.progress === null ? 'no tasks' : `${spec.progress.completed}/${spec.progress.required} required tasks (${spec.progress.percent}%)`;
    const ready = spec.ready.length === 0 ? '' : ` · next: ${spec.ready.map((task) => task.id).join(', ')}`;
    lines.push(`- ${spec.feature} [${spec.specType}/${spec.workflowType}] ${spec.phase} — ${spec.requirements} reqs, ${spec.clauses} criteria · ${progress}${ready} · ${spec.ok ? 'format OK' : `${spec.issues.error} errors`}`);
  }
  return lines.join('\n');
}

function renderState(value) {
  const lines = [
    `Spec ${value.feature} — phase ${value.phase}`,
    `Directory: ${value.directory}`,
    `Type: ${value.config.specType} · workflow: ${value.config.workflowType}`,
    `Requirements: ${value.requirements.length} (${value.requirements.reduce((sum, req) => sum + req.criteria.length, 0)} criteria) · properties: ${value.properties.length}`,
  ];
  if (value.progress !== null) {
    lines.push(`Tasks: ${value.progress.completed}/${value.progress.required} required complete (${value.progress.percent}%)${value.progress.inProgress > 0 ? `, ${value.progress.inProgress} in progress` : ''}`);
  }
  if (value.ready.length > 0) lines.push(`Ready: ${value.ready.map((task) => `${task.id} ${task.title}${task.wave === null ? '' : ` (wave ${task.wave})`}`).join(' | ')}`);
  if (value.requirements.length > 0) {
    lines.push('', 'Requirements:');
    for (const requirement of value.requirements) {
      lines.push(`- ${requirement.id} ${requirement.title}${requirement.userStory === '' ? '' : ` — ${requirement.userStory}`}`);
      for (const criterion of requirement.criteria) lines.push(`  - ${criterion.id} ${criterion.text}`);
    }
  }
  if (value.properties.length > 0) {
    lines.push('', 'Correctness properties:');
    for (const property of value.properties) lines.push(`- Property ${property.number} ${property.title} [${property.kind}] validates ${property.validates.join(', ') || '—'}`);
  }
  if (value.issues.length > 0) lines.push('', `Findings (${value.counts.error} errors, ${value.counts.warning} warnings):`, ...renderIssues(value.issues));
  return lines.join('\n');
}

function renderCheck(value) {
  const lines = [`Spec check — ${value.ok ? 'OK' : 'NOT OK'}${value.strict ? ' (strict)' : ''}`, `Root: ${value.root} · ${value.specs.length} spec(s) · ${value.totals.error} errors, ${value.totals.warning} warnings, ${value.totals.info} info.`];
  for (const spec of value.specs) {
    lines.push('', `## ${spec.feature} [${spec.phase}] — ${spec.ok ? 'OK' : `${spec.counts.error} errors`}`);
    if (spec.issues.length === 0) {
      lines.push('- No findings.');
      continue;
    }
    lines.push(...renderIssues(spec.issues, 20));
  }
  return lines.join('\n');
}

function renderTaskResult(value) {
  const lines = [`Task ${value.taskId} → ${value.status} (${value.feature})`];
  if (value.propagated.length > 0) lines.push(`Auto-completed parents: ${value.propagated.map((change) => change.taskId).join(', ')}`);
  if (value.warnings.length > 0) lines.push('Warnings:', ...value.warnings.map((warning) => `- ${warning}`));
  if (value.ready.length > 0) lines.push(`Newly ready: ${value.ready.map((task) => `${task.id} ${task.title}`).join(' | ')}`);
  return lines.join('\n');
}
/* ------------------------------------------------------------------------- *
 * Tool definitions
 * ------------------------------------------------------------------------- */

function createToolDefinitions(ctx, config) {
  return [
    {
      name: TOOL_NAMES.create,
      description:
        'Create a Kiro-format spec directory under .kiro/specs/<feature> with .config.kiro and the chosen document skeleton(s). Use before non-trivial feature work or when the user asks for requirements/design/tasks. Defaults: requirements-first workflow, feature spec, only requirements.md is scaffolded; add design/tasks later with spec_write after the previous phase is approved.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Human title; the feature directory is a kebab-case slug of it.' },
          feature: { type: 'string', description: 'Explicit kebab-case directory name; overrides the slug.' },
          specType: { type: 'string', enum: SPEC_TYPES, description: 'feature (default), bugfix, or quick-spec.' },
          workflowType: { type: 'string', enum: WORKFLOW_TYPES, description: 'requirements-first (default), design-first, fast-task, verify-first.' },
          documents: {
            type: 'array',
            items: { type: 'string', enum: ['requirements', 'design', 'tasks'] },
            description: 'Documents to scaffold. Defaults to ["requirements"] (bugfix.md for specType bugfix).',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['feature', 'directory', 'files', 'specType', 'workflowType', 'phase', 'summary', 'issues', 'counts'],
          properties: {
            feature: TEXT, directory: TEXT, files: { type: 'array', items: TEXT },
            specType: TEXT, workflowType: TEXT, phase: TEXT,
            summary: { type: 'object', additionalProperties: true },
            issues: { type: 'array', items: ISSUE },
            counts: COUNTS,
          },
        },
        render: (_args, value) => textContent(renderCreate(value)),
      },
      async execute(args, exec) {
        return createSpec(ctx, config, exec, args);
      },
    },
    {
      name: TOOL_NAMES.list,
      description:
        'List Kiro specs in the current workspace with type, workflow, phase, requirement/task progress, ready tasks, and format health. Use before creating a spec (avoid duplicates) and to find the spec that governs the work.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['workspace', 'root', 'specs'],
          properties: { workspace: TEXT, root: TEXT, specs: { type: 'array', items: SPEC_LIST_ENTRY } },
        },
        render: (_args, value) => textContent(renderList(value)),
      },
      async execute(args, exec) {
        return listSpecsOp(ctx, config, exec);
      },
    },
    {
      name: TOOL_NAMES.read,
      description:
        'Read one spec. Without `document`, returns the derived model: phase, requirements with numbered criteria, correctness properties, the task tree with Kiro statuses/waves, ready tasks, and validation findings. With `document`, returns that file verbatim (requirements, bugfix, design or tasks) plus its issues.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['feature'],
        properties: {
          feature: { type: 'string' },
          document: { type: 'string', enum: ['requirements', 'bugfix', 'design', 'tasks'] },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          required: ['feature'],
          properties: {
            feature: TEXT, directory: TEXT, phase: TEXT, document: TEXT, content: TEXT,
            config: { type: 'object', additionalProperties: true },
            requirements: { type: 'array', items: { type: 'object', additionalProperties: true } },
            properties: { type: 'array', items: { type: 'object', additionalProperties: true } },
            tasks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            dependencyGraph: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
            progress: { oneOf: [PROGRESS, { type: 'null' }] },
            ready: { type: 'array', items: TASK_BRIEF },
            issues: { type: 'array', items: ISSUE },
            counts: COUNTS,
            ok: { type: 'boolean' },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        render: (_args, value) => textContent(
          typeof value.content === 'string'
            ? `# ${value.document} — ${value.feature}\n\n${value.content}${value.issues.length === 0 ? '' : `\n\nFindings:\n${renderIssues(value.issues, 20).join('\n')}`}`
            : renderState(value),
        ),
      },
      async execute(args, exec) {
        return readSpecOp(ctx, config, exec, args);
      },
    },
    {
      name: TOOL_NAMES.write,
      description:
        'Write or replace one whole spec document (requirements.md, bugfix.md, design.md, tasks.md) and immediately validate it with Kiro\'s format rules. Use it to commit the document for the current phase; the Markdown you write is the source of truth. Validation errors are returned, not silently fixed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['feature', 'document', 'content'],
        properties: {
          feature: { type: 'string' },
          document: { type: 'string', enum: ['requirements', 'bugfix', 'design', 'tasks'] },
          content: { type: 'string', description: 'Complete Markdown document.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['feature', 'document', 'path', 'phase', 'ok', 'counts', 'issues'],
          properties: {
            feature: TEXT, document: TEXT, path: TEXT, phase: TEXT, ok: { type: 'boolean' },
            counts: COUNTS, issues: { type: 'array', items: ISSUE },
          },
        },
        render: (_args, value) => textContent([
          `Wrote ${value.document} for ${value.feature} (phase ${value.phase}) at ${value.path}`,
          value.ok ? 'Format check: OK' : `Format check: ${value.counts.error} error(s), ${value.counts.warning} warning(s)`,
          ...(value.issues.length === 0 ? [] : ['', 'Findings:', ...renderIssues(value.issues)]),
        ].join('\n')),
      },
      async execute(args, exec) {
        return writeSpecOp(ctx, config, exec, args);
      },
    },
    {
      name: TOOL_NAMES.check,
      description:
        'Validate specs with Kiro\'s exact rules (requirements/design/tasks/bugfix headings, EARS clauses, property annotations, checkbox grammar, Task Dependency Graph) plus cross-document checks (unknown requirement references, missing PBT tasks, missing documents). Use after every write and before declaring a phase complete. `strict` also fails on warnings.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          feature: { type: 'string', description: 'Check one spec; omit to check all.' },
          strict: { type: 'boolean', description: 'Treat warnings as failures.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['root', 'strict', 'ok', 'specs', 'totals'],
          properties: {
            root: TEXT, strict: { type: 'boolean' }, ok: { type: 'boolean' },
            specs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['feature', 'phase', 'ok', 'counts', 'issues'],
                properties: {
                  feature: TEXT, phase: TEXT, ok: { type: 'boolean' }, counts: COUNTS,
                  issues: { type: 'array', items: ISSUE },
                  summary: { type: 'object', additionalProperties: true },
                },
              },
            },
            totals: COUNTS,
          },
        },
        render: (_args, value) => textContent(renderCheck(value)),
      },
      async execute(args, exec) {
        return checkSpecOp(ctx, config, exec, args);
      },
    },
    {
      name: TOOL_NAMES.taskUpdate,
      description:
        'Update a task checkbox in tasks.md, exactly like Kiro\'s task_update: statuses are not_started ([ ]), queued ([~]), in_progress ([-]), completed ([x]). Completing all required children auto-completes the parent; completing a parent with open required children is rejected. With status "queued" and no taskId, queues every not-started non-optional leaf. Records execution history in tasks.meta.json when a session is available.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['feature', 'status'],
        properties: {
          feature: { type: 'string' },
          taskId: { type: 'string', description: 'Task id such as 1, 2.1, or 2.1.3. Omit only with status "queued".' },
          status: { type: 'string', enum: ['not_started', 'queued', 'in_progress', 'completed'] },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          required: ['feature', 'status'],
          properties: {
            feature: TEXT, taskId: TEXT, status: TEXT,
            propagated: { type: 'array', items: { type: 'object', additionalProperties: true } },
            warnings: { type: 'array', items: TEXT },
            ready: { type: 'array', items: TASK_BRIEF },
            queued: { type: 'array', items: TEXT },
            results: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_args, value) => textContent(
          Array.isArray(value.queued)
            ? `Queued ${value.queued.length} task(s) in ${value.feature}: ${value.queued.join(', ')}`
            : renderTaskResult(value),
        ),
      },
      async execute(args, exec) {
        return taskUpdateOp(ctx, config, exec, args);
      },
    },
    {
      name: TOOL_NAMES.next,
      description:
        'Return what to do next for one spec: ready tasks in dependency-graph wave order (linear for bugfix), or the phase that still needs a document. Use it to drive task execution and to decide between writing requirements, design, tasks, or running code.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['feature'],
        properties: {
          feature: { type: 'string' },
          includeOptional: { type: 'boolean', description: 'Include optional (*) tasks. Defaults to false.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          required: ['feature', 'phase', 'ready'],
          properties: {
            feature: TEXT, phase: TEXT,
            progress: { oneOf: [PROGRESS, { type: 'null' }] },
            ok: { type: 'boolean' }, counts: COUNTS,
            ready: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['id', 'title'],
                properties: { id: TEXT, title: TEXT, wave: NULLABLE_NUMBER, requirements: { type: 'array', items: TEXT }, optional: { type: 'boolean' } },
              },
            },
          },
        },
        render: (_args, value) => textContent([
          `Spec ${value.feature} — phase ${value.phase}${value.progress === null ? '' : ` · ${value.progress.completed}/${value.progress.required} required tasks complete`}`,
          value.ready.length === 0
            ? (value.phase === 'execution' || value.phase === 'done' ? 'No ready required tasks.' : `Next phase: ${value.phase} — write the document with ${TOOL_NAMES.write}.`)
            : `Ready: ${value.ready.map((task) => `${task.id} ${task.title}${task.wave === null ? '' : ` [wave ${task.wave}]`}`).join(' | ')}`,
        ].join('\n')),
      },
      async execute(args, exec) {
        return nextOp(ctx, config, exec, args);
      },
    },
    {
      name: TOOL_NAMES.pbt,
      description:
        'Record the outcome of one property-based test task in tasks.meta.json (Kiro\'s pbtResults). Use it after running a property test: status "passed" or "failed" plus the minimized failing example when it failed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['feature', 'taskId', 'status'],
        properties: {
          feature: { type: 'string' },
          taskId: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'failed'] },
          failingExample: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          required: ['feature', 'taskId', 'status'],
          properties: {
            feature: TEXT, taskId: TEXT, status: TEXT, failingExample: TEXT, lastRunTimestamp: NUMBER,
          },
        },
        render: (_args, value) => textContent(`Recorded PBT ${value.status} for ${value.feature} task ${value.taskId}${value.failingExample === undefined ? '' : ` — example: ${value.failingExample}`}`),
      },
      async execute(args, exec) {
        return pbtOp(ctx, config, exec, args);
      },
    },
  ];
}
/* ------------------------------------------------------------------------- *
 * Prompt
 * ------------------------------------------------------------------------- */

/** Static policy: Kiro's spec contract, compressed to the durable rules. */
export const SPEC_POLICY_TEXT = `## Kiro-style specs

This workspace uses Kiro's spec format under \`.kiro/specs/<feature>/\`. A spec is three Markdown documents (plus \`.config.kiro\`) and the tasks' checkboxes are its status.

- **requirements.md** (or **bugfix.md**): \`# Requirements Document\` → \`## Introduction\` → \`## Glossary\` → \`## Requirements\`; each \`### Requirement N: Title\` has a **User Story:** and \`#### Acceptance Criteria\` written as EARS clauses ("WHEN …, THE System SHALL …"). Criteria are referenced as N.M.
- **design.md**: \`## Overview\`, \`## Architecture\`, \`## Components and Interfaces\`, \`## Data Models\`, \`## Correctness Properties\`, \`## Error Handling\`, \`## Testing Strategy\`. Every property is a \`### Property N: Title\` with \`**Validates: Requirements X.Y**\`.
- **tasks.md**: \`# Implementation Plan\`, \`## Overview\`, \`## Tasks\` with \`- [ ] N.M …\` checkboxes (two levels max), \`_Requirements: X.Y_\` references, optional subtasks marked \`- [ ]* N.M\`, checkpoints, \`## Notes\`, and a \`## Task Dependency Graph\` JSON block of contiguous waves. Bugfix specs run linearly and omit the graph.

Workflow: create the spec, write requirements and stop for review; then design (with correctness properties); then tasks (with the dependency graph); then execute tasks one at a time. Never skip a phase or write a later document before the earlier one is approved.

Status is the checkbox itself: \`[ ]\` not started, \`[~]\` queued, \`[-]\` in progress, \`[x]\` complete. Update it with \`spec_task_update\`; never mark a task complete while required subtasks are open, and never mark a property test passed without having run it. \`spec_check\` returns Kiro's format rules; fix errors before claiming a phase is done.`;

/** Register/refresh prompt contributions when settings change. */
/**
 * Settings snapshot read at assembly time.
 *
 * Prompt providers must answer synchronously, so this reads the settings file
 * directly instead of going through the async helpers. A save in the Web panel
 * therefore reaches the very next model step without re-registering anything.
 * @param {unknown} config - profile config.
 * @returns {{kiroDir: string, promptEnabled: boolean, includeActiveSpecs: boolean, promptMaxSpecs: number, strict: boolean, defaultSpecType: string, defaultWorkflow: string}}
 */
function liveSettings(config) {
  const configPart = configSettings(config).values;
  let stored = {};
  try {
    stored = sanitizeSettings(JSON.parse(readFileSync(settingsFilePath(), 'utf8'))).values;
  } catch {
    // absent or unreadable settings file keeps config/defaults
  }
  return { ...DEFAULT_SETTINGS, ...configPart, ...stored };
}

/**
 * The language the documents should be written in.
 *
 * Settings first (an explicit `language`), then the language the user picked
 * for DSH itself. See `./language.js` for the chain.
 * @param {object} settings - resolved plugin settings.
 * @returns {'zh'|'en'}
 */
function activeLanguage(settings) {
  return resolveLanguage({ settings, localePreference: readLocalePreference(profilePatchPath()) });
}

/**
 * Register the Kiro policy section and the active-spec context in the calling
 * (preset) scope.
 *
 * Both contributions are registered once and consult {@link liveSettings} per
 * assembly; returning an empty string drops them from the rendered prompt.
 * @param {object} ctx - Cordis context of the preset scope.
 * @param {unknown} config - profile config.
 * @returns {{install: () => Promise<void>, uninstall: () => void}}
 */
function installPrompt(ctx, config) {
  let promptService = null;
  let disposers = [];
  const uninstall = () => {
    for (const dispose of disposers) {
      try {
        dispose?.();
      } catch {
        // already disposed with the prompt scope
      }
    }
    disposers = [];
  };
  const install = async () => {
    if (promptService === null || typeof promptService.section !== 'function') {
      noteDiagnostic(ctx, 'spec: systemPrompt is unavailable in this preset scope; tools load without the Kiro policy section');
      return;
    }
    uninstall();
    try {
      const section = promptService.section({
        name: 'spec-policy',
        order: 185,
        interpolate: false,
        // The policy paragraph is a format contract and stays English, but the
        // *language the documents are written in* is the user's DSH language.
        // Read per assembly, so a switch in Settings reaches the next model
        // step without re-registering the section.
        text: () => {
          const settings = liveSettings(config);
          if (settings.promptEnabled !== true) return '';
          return `${SPEC_POLICY_TEXT}\n\n${languageInstruction(activeLanguage(settings))}`;
        },
      });
      if (typeof section === 'function') disposers.push(section);
      if (typeof promptService.context === 'function') {
        const context = promptService.context({
          name: 'spec-active',
          order: 650,
          text: (assembly) => {
            try {
              const settings = liveSettings(config);
              if (settings.includeActiveSpecs !== true || settings.promptMaxSpecs === 0) return '';
              const workspace = workspaceFor(ctx, { agent: assembly?.agent });
              const root = specsRoot(workspace, settings.kiroDir);
              // Synchronous read: prompt providers must return a string.
              let entries;
              try {
                entries = readdirSync(root, { withFileTypes: true });
              } catch {
                return '';
              }
              const lines = [];
              for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
                if (lines.length >= settings.promptMaxSpecs) break;
                const directory = path.join(root, entry.name);
                let specConfig = { specType: 'feature', workflowType: 'requirements-first' };
                try {
                  specConfig = JSON.parse(readFileSync(path.join(directory, '.config.kiro'), 'utf8'));
                } catch {
                  // missing config keeps defaults
                }
                let taskText = 'no tasks yet';
                try {
                  const tasks = parseTasks(readFileSync(path.join(directory, 'tasks.md'), 'utf8'));
                  const progress = taskProgress(tasks);
                  const ready = readyTasks(tasks).map((task) => task.id).slice(0, 4).join(', ');
                  taskText = `${progress.completed}/${progress.required} required tasks (${progress.percent}%)${ready === '' ? '' : `; ready: ${ready}`}`;
                } catch {
                  // no tasks.md yet
                }
                lines.push(`- \`${entry.name}\` [${specConfig.specType ?? 'feature'}/${specConfig.workflowType ?? 'requirements-first'}] — ${taskText}`);
              }
              if (lines.length === 0) return '';
              return ['## Specs in this workspace', '', ...lines, '', 'Read one with `spec_read` and drive the current phase before writing code.'].join('\n');
            } catch {
              return '';
            }
          },
        });
        if (typeof context === 'function') disposers.push(context);
      }
    } catch (error) {
      noteDiagnostic(ctx, `spec: prompt registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  // Soft lookup: the preset may be composed without a prompt registry.
  if (typeof ctx?.get === 'function') {
    try {
      promptService = ctx.get('systemPrompt', false) ?? null;
    } catch {
      promptService = null;
    }
  }
  if (promptService === null && typeof ctx?.inject === 'function') {
    // Late-binding path: wait for the registry instead of installing now.
    ctx.inject(['systemPrompt'], (inner) => {
      promptService = inner?.systemPrompt ?? null;
      if (promptService !== null) void install();
      inner.on?.('dispose', uninstall);
    });
  } else if (promptService !== null) {
    void install();
  } else {
    // No registry and no injection support: the tools still load, and the
    // diagnostic is recorded once rather than on every assembly.
    noteDiagnostic(ctx, 'spec: systemPrompt is unavailable in this preset scope; tools load without the Kiro policy section');
  }
  return { install, uninstall };
}

function noteDiagnostic(ctx, message) {
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message);
  } catch {
    // diagnostics never break load
  }
}
/* ------------------------------------------------------------------------- *
 * Entry
 * ------------------------------------------------------------------------- */

/**
 * Mount the preset half in the calling (preset) scope.
 * @param {object} ctx - Cordis context of the preset scope.
 * @param {unknown} [config] - profile config.
 */
export function apply(ctx, config) {
  const toolDisposers = [];
  for (const definition of createToolDefinitions(ctx, config)) {
    const dispose = ctx.tools.register(definition);
    if (typeof dispose === 'function') toolDisposers.push(dispose);
  }
  const prompt = installPrompt(ctx, config);
  ctx.on?.('dispose', () => {
    prompt.uninstall();
    for (const dispose of toolDisposers) {
      try {
        dispose();
      } catch {
        // the registry may already be gone with the scope
      }
    }
  });
}
