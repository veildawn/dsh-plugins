/**
 * dsh-spec — localized validator findings.
 *
 * Findings are produced once, on the server, as `{severity, rule, message,
 * params, file, line}`. `message` stays English: it is what the Agent reads
 * through `spec_check`, and the policy it is checked against is English too.
 * The Web panel is read by a person, so it renders `localizeIssue(issue,
 * lang)`, which rebuilds the sentence from the rule id and the structured
 * `params` the producer attached — never by translating prose, so a rewording
 * in one language cannot silently drift from the other.
 *
 * A rule with no translation falls back to its English message rather than a
 * made-up sentence: a missing string must never read worse than no i18n.
 *
 * @module dsh-spec/messages
 */

/** `{param}` interpolation, kept tiny on purpose. */
function fill(template, params) {
  return template.replace(/\{(\w+)\}/gu, (match, key) => {
    const value = params?.[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Chinese copy, keyed by rule id. `{name}`-style holes are filled from the
 * issue's `params`. Document names (`requirements.md`), heading text and EARS
 * keywords stay verbatim: they are what the user types into the file.
 */
export const ZH = Object.freeze({
  'requirements/missing-title': '缺少必需标题：# Requirements Document',
  'requirements/missing-introduction': '缺少必需章节：## Introduction',
  'requirements/missing-glossary': '缺少建议章节：## Glossary',
  'requirements/missing-requirements-section': '缺少必需章节：## Requirements',
  'requirements/malformed-requirement-heading': '需求标题格式不符。应为：### Requirement N: 标题',
  'requirements/missing-user-story': '需求块缺少 **User Story:**',
  'requirements/missing-acceptance-criteria': '需求块缺少 #### Acceptance Criteria',

  'design/missing-overview': '缺少必需章节：## Overview',
  'design/missing-architecture': '缺少必需章节：## Architecture',
  'design/missing-components': '缺少必需章节：## Components and Interfaces',
  'design/missing-data-models': '缺少必需章节：## Data Models',
  'design/missing-correctness-properties': '缺少建议章节：## Correctness Properties',
  'design/missing-error-handling': '缺少建议章节：## Error Handling',
  'design/missing-testing-strategy': '缺少建议章节：## Testing Strategy',
  'design/missing-glossary': '缺少建议章节：## Glossary',
  'design/missing-bug-details': '缺少必需章节：## Bug Details',
  'design/missing-expected-behavior': '缺少必需章节：## Expected Behavior',
  'design/missing-hypothesized-root-cause': '缺少必需章节：## Hypothesized Root Cause',
  'design/missing-fix-implementation': '缺少必需章节：## Fix Implementation',
  'design/malformed-property-heading': '属性标题格式不符。应为：Property N: 标题 或 ### Property N: 标题',
  'design/empty-correctness-properties': 'Correctness Properties 章节里没有属性。至少需要一个 Property N: 标题',
  'design/missing-property-validates': '属性缺少 **Validates: Requirements X.Y** 引用',

  'tasks/missing-implementation-plan': '缺少必需标题：# Implementation Plan:',
  'tasks/missing-overview': '缺少建议章节：## Overview',
  'tasks/missing-tasks-section': '缺少建议章节：## Tasks',
  'tasks/invalid-task-heading': '任务必须用复选框格式（- [ ] N. 描述），不能用 ## 或 ### 标题',
  'tasks/malformed-checkbox': '复选框格式有误。用 - [ ]（未完成）或 - [x]（已完成，小写）',
  'tasks/invalid-task-line': '任务行格式不符，应为：- [ ] N. 或 - [x] N.',
  'tasks/invalid-subtask-line': '子任务行格式不符，应为：- [ ] N.M 或 - [x] N.M',
  'tasks/missing-notes': '缺少建议章节：## Notes',
  'tasks/missing-dependency-graph': '缺少必需章节：## Task Dependency Graph。',
  'tasks/bugfix-unexpected-dag': 'bugfix 任务清单不应包含 Task Dependency Graph（bugfix 任务按线性顺序执行）。请删除 ## Task Dependency Graph 章节。',
  'tasks/missing-dag-json': 'Task Dependency Graph 章节缺少定义波次的 JSON 代码块。',
  'tasks/empty-dag-json': 'Task Dependency Graph 的 JSON 块是空的。',
  'tasks/invalid-dag-json': 'Task Dependency Graph 含无效 JSON。',
  'tasks/invalid-dag-structure': 'Task Dependency Graph 的 "waves" 必须是非空数组。',

  'bugfix/missing-introduction': '缺少必需章节：## Introduction',
  'bugfix/missing-bug-analysis': '缺少必需章节：## Bug Analysis',
  'bugfix/missing-current-behavior': '缺少必需章节：### Current Behavior (Defect)',
  'bugfix/missing-expected-behavior': '缺少必需章节：### Expected Behavior (Correct)',
  'bugfix/missing-unchanged-behavior': '缺少必需章节：### Unchanged Behavior (Regression Prevention)',
  'bugfix/unexpected-section': '章节 "{heading}" 属于 design 文档，不应出现在 bugfix 文档中',

  // `{at}` is the localized location (`第 5 条需求第 3 项`), rebuilt from the
  // requirement and criterion numbers the producer attached. A finding written
  // before those fields existed falls back to its English `where`.
  'ears/missing-pattern': '{at}不符合 EARS 句式（WHEN/WHILE/IF/WHERE … SHALL …）',
  'ears/missing-shall': '{at}没有 SHALL 子句',
  'ears/vague-verb': '{at}使用了含糊或兜底动词（"{verb}"），请写明可观测的响应',
  'ears/compound-criterion': '{at}含多个 SHALL 子句，建议拆分',

  'spec/missing-document': '文档尚未编写：{file}',
  'spec/unknown-requirement': '任务 {taskId} 引用了不存在的需求 {requirement}',
  'spec/unknown-validates': '属性 {property} 校验了不存在的需求 {requirement}',
  'spec/unlinked-requirement': '需求 {requirement} 没有被任何任务引用',
  'spec/bugfix-dag': 'bugfix 任务清单不能包含 Task Dependency Graph',
  'spec/missing-pbt-task': '设计里定义了正确性属性，但任务里没有属性测试任务',

  'dag/non-contiguous-waves': '波次 id 必须从 0 连续编号；第 {position} 个位置上是 id {waveId}。',
  'dag/unknown-task': '第 {waveId} 波包含 "{taskId}"，它不是 tasks.md 里的叶子任务。',
  'dag/duplicate-task': '任务 "{taskId}" 同时出现在第 {first} 波和第 {second} 波。',
  'dag/missing-task': '叶子任务 "{taskId}" 不在依赖图里；它会被排在最后一波之后执行。',
});

/**
 * The error message for one finding, in the panel's language.
 *
 * @param {{rule?: string, message?: string, params?: object}} issue
 * @param {'zh'|'en'} language
 * @returns {string}
 */
export function localizeIssue(issue, language) {
  const english = typeof issue?.message === 'string' ? issue.message : '';
  if (language !== 'zh') return english;
  const template = issue?.rule === undefined ? undefined : ZH[issue.rule];
  if (template === undefined) return english;
  return fill(template, paramsOf(issue.params));
}

/**
 * The holes a Chinese template fills, including the location ones.
 *
 * The validator publishes `requirement` and `criterion` as numbers-as-strings,
 * and the English `where` beside them. A localized sentence wants its own
 * phrasing (Chinese puts the numbers before the noun: `第 5 条需求第 3 项`), so
 * `at` is composed here rather than translated from the English sentence.
 * Chinese uses no space between the location and the rest, which is why the
 * templates start directly with the predicate.
 *
 * @param {object} [params]
 * @returns {object}
 */
function paramsOf(params) {
  if (params === null || typeof params !== 'object') return params;
  if (params.requirement !== undefined && params.criterion !== undefined) {
    return { ...params, at: `第 ${params.requirement} 条需求第 ${params.criterion} 项` };
  }
  // Pre-0.8.2 findings carry only the composed English `where`. Show it as it
  // is rather than a literal `{at}`: a stale finding must read, not glitch.
  if (typeof params.where === 'string' && params.where !== '') return { ...params, at: params.where };
  return { ...params, at: '' };
}

/**
 * Localize a whole findings list, preserving order and every other field.
 *
 * @param {object[]} issues
 * @param {'zh'|'en'} language
 * @returns {object[]}
 */
export function localizeIssues(issues, language) {
  if (language !== 'zh' || !Array.isArray(issues)) return issues;
  return issues.map((issue) => ({ ...issue, message: localizeIssue(issue, language) }));
}
