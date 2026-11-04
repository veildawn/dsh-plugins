/**
 * Saved-workflow library, modelled on ZCode's `workflows/*` store.
 *
 * A saved workflow is one JSON file `<dir>/<name>.json` holding the script,
 * its meta block and default args. Two scopes, same as ZCode:
 *
 *   - `project`: `<session cwd>/.dsh/workflows`
 *   - `global`:  `$DSH_HOME/dynamic-workflow/workflows`
 *
 * Lookups without an explicit scope prefer `project` over `global`.
 *
 * @module dsh-dynamic-workflow/library
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SCOPES = ['project', 'global'];
/** ZCode caps: script ≤ 256 000 chars, args JSON ≤ 4096 bytes, description ≤ 500. */
export const MAX_SCRIPT = 256_000;
export const MAX_ARGS_BYTES = 4096;
export const MAX_DESCRIPTION = 500;

/** Letters and digits of any script (so 中文 names work), plus `.`, `_`, `-`. */
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;

export class LibraryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Normalize a free-form name into a safe file stem, or throw. */
export function normalizeName(raw) {
  if (typeof raw !== 'string') throw new LibraryError('invalid-argument', 'workflow name is required');
  const name = raw.trim().toLowerCase().replace(/[\s/\\]+/gu, '-').replace(/[^\p{L}\p{N}._-]/gu, '').replace(/^[._-]+/u, '').slice(0, 64);
  if (!NAME_RE.test(name)) throw new LibraryError('invalid-argument', `invalid workflow name "${raw}"`);
  return name;
}

function checkScope(scope) {
  if (scope === undefined || scope === null || scope === '') return undefined;
  if (!SCOPES.includes(scope)) throw new LibraryError('invalid-argument', `scope must be project or global`);
  return scope;
}

function checkArgs(args) {
  if (args === undefined || args === null) return undefined;
  if (typeof args !== 'object' || Array.isArray(args)) throw new LibraryError('invalid-argument', 'args must be a JSON object');
  const size = Buffer.byteLength(JSON.stringify(args), 'utf8');
  if (size > MAX_ARGS_BYTES) throw new LibraryError('invalid-argument', `args JSON must be ≤ ${MAX_ARGS_BYTES} bytes (got ${size})`);
  return args;
}

function summary(record, scope, file) {
  return {
    name: record.name,
    scope,
    path: file,
    description: record.description ?? '',
    whenToUse: record.whenToUse ?? '',
    phases: Array.isArray(record.meta?.phases) ? record.meta.phases.map((p) => p.title).filter(Boolean) : [],
    hasArgs: record.args !== undefined && record.args !== null,
    savedAt: record.savedAt ?? null,
    sourceRunId: record.sourceRunId ?? null,
  };
}

export function createWorkflowLibrary({ globalDir, now = Date.now }) {
  const projectDir = (cwd) => path.join(cwd, '.dsh', 'workflows');
  const dirFor = (scope, cwd) => {
    if (scope === 'global') return globalDir;
    if (typeof cwd !== 'string' || cwd === '') throw new LibraryError('no-workspace', 'project scope needs a session workspace');
    return projectDir(cwd);
  };

  async function readRecord(file) {
    try {
      const record = JSON.parse(await readFile(file, 'utf8'));
      if (!record || typeof record.script !== 'string' || typeof record.name !== 'string') return null;
      return record;
    } catch {
      return null;
    }
  }

  async function listDir(scope, cwd) {
    let dir;
    try { dir = dirFor(scope, cwd); } catch { return []; }
    let names = [];
    try { names = await readdir(dir); } catch { return []; }
    const out = [];
    for (const entry of names.sort()) {
      if (!entry.endsWith('.json')) continue;
      const file = path.join(dir, entry);
      const record = await readRecord(file);
      if (record) out.push(summary(record, scope, file));
    }
    return out;
  }

  return {
    globalDir,
    projectDir,

    async list({ cwd } = {}) {
      return [...(await listDir('project', cwd)), ...(await listDir('global', cwd))];
    },

    /** Full record, or null. Without a scope, project shadows global. */
    async get(rawName, { scope, cwd } = {}) {
      const name = normalizeName(rawName);
      const wanted = checkScope(scope);
      for (const candidate of wanted ? [wanted] : SCOPES) {
        let dir;
        try { dir = dirFor(candidate, cwd); } catch { continue; }
        const file = path.join(dir, `${name}.json`);
        const record = await readRecord(file);
        if (record) return { ...record, ...summary(record, candidate, file), script: record.script, args: record.args ?? null, meta: record.meta ?? null };
      }
      return null;
    },

    async save({ meta, script, args }, { scope = 'project', cwd, sourceRunId } = {}) {
      const target = checkScope(scope) ?? 'project';
      if (typeof script !== 'string' || script.trim() === '') throw new LibraryError('invalid-argument', 'script is required');
      if (script.length > MAX_SCRIPT) throw new LibraryError('invalid-argument', `script must be ≤ ${MAX_SCRIPT} chars`);
      const name = normalizeName(meta?.name);
      const description = typeof meta?.description === 'string' ? meta.description.slice(0, MAX_DESCRIPTION) : '';
      const record = {
        version: 1,
        name,
        description,
        ...(typeof meta?.whenToUse === 'string' && meta.whenToUse !== '' ? { whenToUse: meta.whenToUse.slice(0, MAX_DESCRIPTION) } : {}),
        meta: {
          name,
          description: description || name,
          ...(typeof meta?.whenToUse === 'string' && meta.whenToUse !== '' ? { whenToUse: meta.whenToUse.slice(0, MAX_DESCRIPTION) } : {}),
          ...(Array.isArray(meta?.phases) ? { phases: meta.phases } : {}),
        },
        script,
        ...(checkArgs(args) !== undefined ? { args } : {}),
        savedAt: now(),
        ...(typeof sourceRunId === 'string' ? { sourceRunId } : {}),
      };
      const dir = dirFor(target, cwd);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${name}.json`);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`);
      await rename(tmp, file);
      return summary(record, target, file);
    },

    async remove(rawName, { scope, cwd } = {}) {
      const name = normalizeName(rawName);
      const wanted = checkScope(scope);
      for (const candidate of wanted ? [wanted] : SCOPES) {
        let dir;
        try { dir = dirFor(candidate, cwd); } catch { continue; }
        const file = path.join(dir, `${name}.json`);
        if ((await readRecord(file)) !== null) {
          await rm(file, { force: true });
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * The follow-up turn that re-runs a saved workflow (ZCode's `workflowLaunch`
 * origin). The model is asked to call the `workflow` tool with the saved
 * arguments verbatim; explicit args override the saved defaults key by key.
 */
export function launchPrompt(saved, overrideArgs, lang = 'en') {
  const extra = checkArgs(overrideArgs);
  const base = saved.args && typeof saved.args === 'object' ? saved.args : undefined;
  const args = extra !== undefined || base !== undefined ? { ...(base ?? {}), ...(extra ?? {}) } : undefined;
  const call = {
    meta: saved.meta ?? { name: saved.name, description: saved.description || saved.name },
    script: saved.script,
    ...(args !== undefined ? { args } : {}),
  };
  const head = lang === 'zh'
    ? [
      `运行已保存的 workflow「${saved.name}」（${saved.scope === 'global' ? '全局' : '项目'}）。`,
      '用下面的 JSON 参数原样调用一次 `workflow` 工具，不要修改脚本或 meta。运行结束后用中文总结结果。',
    ]
    : [
      `Run the saved workflow "${saved.name}" (${saved.scope}).`,
      'Call the `workflow` tool exactly once with the JSON arguments below, verbatim — do not edit the script or meta. When it finishes, summarize its result for me.',
    ];
  return [...head, '', '```json', JSON.stringify(call, null, 2), '```'].join('\n');
}

/**
 * `/workflow` input grammar: `[name] [--global|--project] [json-object]`.
 * Empty input lists workflows.
 */
export function parseCommandInput(raw) {
  let rest = typeof raw === 'string' ? raw.trim() : '';
  if (rest === '') return { name: '', scope: undefined, args: undefined, text: '' };
  let scope;
  rest = rest.replace(/(^|\s)--(global|project)(?=\s|$)/gu, (_, lead, which) => {
    scope = which;
    return lead;
  }).trim();
  rest = rest.replace(/\s+/gu, ' ');
  const text = rest;
  const brace = rest.indexOf('{');
  const head = (brace === -1 ? rest : rest.slice(0, brace)).trim();
  let args;
  let jsonOk = true;
  if (brace !== -1) {
    try {
      args = JSON.parse(rest.slice(brace));
      checkArgs(args);
    } catch {
      args = undefined;
      jsonOk = false;
    }
  }
  // A single token (optionally followed by JSON args) may name a saved
  // workflow. Anything else is a task description for the model to orchestrate.
  let name = '';
  if (jsonOk && head !== '' && !/\s/u.test(head)) {
    try { name = normalizeName(head); } catch { name = ''; }
  }
  return { name, scope, args, text };
}

/**
 * The follow-up turn for `/workflow <task>` when no saved workflow matches:
 * ask the model to design a dynamic workflow for the task and run it with the
 * `workflow` tool (ZCode's behaviour for free-text `/workflow`).
 */
export function authorPrompt(task, lang = 'en') {
  if (lang === 'zh') {
    return [
      `为这个任务设计并运行一个动态 workflow：${task}`,
      '',
      '只调用一次 `workflow` 工具。在 `meta.phases` 里声明各阶段，每个阶段开始时调用 `phase()`，用清晰的 label 发起 `agent()` 调用，让进度以节点形式显示在输入框上方。阶段标题和 agent label 用中文，`meta.name` 取一个简短的名称。运行结束后用中文总结结果。',
    ].join('\n');
  }
  return [
    `Design and run a dynamic workflow for this task: ${task}`,
    '',
    'Use the `workflow` tool exactly once. Declare the stages in `meta.phases`, call `phase()` as each stage starts, and fan out `agent()` calls with clear labels so the progress shows up as nodes. Give `meta.name` a short name for the task. When it finishes, summarize the result for me.',
  ].join('\n');
}
