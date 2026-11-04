/**
 * dsh-spec — Kiro-compatible format validation.
 *
 * The rule set mirrors Kiro's `validate_spec_format` implementation
 * (kiroAgent 1.1.530), including rule codes, severity, and the exact heading
 * grammar each document kind must satisfy. Keeping the codes identical means
 * an agent that learned Kiro's output can act on these findings without a
 * translation layer.
 *
 * @module dsh-spec/validate
 */

/** Document kinds Kiro validates. */
export const DOCUMENT_TYPES = ['requirements', 'design', 'tasks', 'bugfix'];

/** Spec types Kiro supports. */
export const SPEC_TYPES = ['feature', 'bugfix', 'quick-spec'];

/** Workflow types Kiro supports. */
export const WORKFLOW_TYPES = ['requirements-first', 'design-first', 'fast-task', 'verify-first'];

/** Map a file name to its validator kind. */
export function documentKindOf(fileName) {
  switch (String(fileName).toLowerCase()) {
    case 'requirements.md': return 'requirements';
    case 'design.md': return 'design';
    case 'tasks.md': return 'tasks';
    case 'bugfix.md': return 'bugfix';
    default: return undefined;
  }
}

function issue(severity, message, rule, line = 0, params) {
  // `message` stays English (the Agent reads it); `params` carries the holes the
  // panel fills to rebuild the same finding in Chinese. See ./messages.js.
  return params === undefined ? { severity, message, line, rule } : { severity, message, line, rule, params };
}

function lines(text) {
  return String(text ?? '').replace(/\r\n?/gu, '\n').split('\n');
}

/**
 * Validate requirements.md.
 * @param {string} text
 * @returns {Array<{severity: string, message: string, line: number, rule: string}>}
 */
export function validateRequirements(text) {
  const found = [];
  const rows = lines(text);
  const has = (pattern) => rows.some((row) => pattern.test(row.trimEnd()));
  if (!has(/^# Requirements Document$/iu)) {
    found.push(issue('error', 'Missing required heading: # Requirements Document', 'requirements/missing-title'));
  }
  if (!has(/^## Introduction$/u)) {
    found.push(issue('error', 'Missing required section: ## Introduction', 'requirements/missing-introduction'));
  }
  if (!has(/^## Glossary$/u)) {
    found.push(issue('warning', 'Missing recommended section: ## Glossary', 'requirements/missing-glossary'));
  }
  if (!has(/^## Requirements$/u)) {
    found.push(issue('error', 'Missing required section: ## Requirements', 'requirements/missing-requirements-section'));
  }
  const good = /^### Requirement \d+:/u;
  const loose = /^### Requirement\b/u;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (loose.test(row) && !good.test(row)) {
      found.push(issue('error', 'Malformed requirement heading. Expected format: ### Requirement N: Title', 'requirements/malformed-requirement-heading', index));
    }
    if (!good.test(row)) continue;
    let end = rows.length;
    for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
      if (/^### /u.test(rows[cursor])) {
        end = cursor;
        break;
      }
    }
    const block = rows.slice(index + 1, end);
    if (!block.some((line) => /\*\*User Story:\*\*/u.test(line))) {
      found.push(issue('warning', 'Requirement block is missing **User Story:**', 'requirements/missing-user-story', index));
    }
    if (!block.some((line) => /^#### Acceptance Criteria$/iu.test(line.trimEnd()))) {
      found.push(issue('error', 'Requirement block is missing #### Acceptance Criteria', 'requirements/missing-acceptance-criteria', index));
    }
  }
  return found;
}

const FEATURE_DESIGN_SECTIONS = [
  { name: 'overview', display: 'Overview', severity: 'error', rule: 'design/missing-overview' },
  { name: 'architecture', display: 'Architecture', severity: 'error', rule: 'design/missing-architecture' },
  { name: 'components and interfaces', display: 'Components and Interfaces', severity: 'error', rule: 'design/missing-components' },
  { name: 'data models', display: 'Data Models', severity: 'error', rule: 'design/missing-data-models' },
  { name: 'correctness properties', display: 'Correctness Properties', severity: 'warning', rule: 'design/missing-correctness-properties' },
  { name: 'error handling', display: 'Error Handling', severity: 'warning', rule: 'design/missing-error-handling' },
  { name: 'testing strategy', display: 'Testing Strategy', severity: 'warning', rule: 'design/missing-testing-strategy' },
];

const BUGFIX_DESIGN_SECTIONS = [
  { name: 'overview', display: 'Overview', severity: 'error', rule: 'design/missing-overview' },
  { name: 'glossary', display: 'Glossary', severity: 'warning', rule: 'design/missing-glossary' },
  { name: 'bug details', display: 'Bug Details', severity: 'error', rule: 'design/missing-bug-details' },
  { name: 'expected behavior', display: 'Expected Behavior', severity: 'error', rule: 'design/missing-expected-behavior' },
  { name: 'hypothesized root cause', display: 'Hypothesized Root Cause', severity: 'error', rule: 'design/missing-hypothesized-root-cause' },
  { name: 'correctness properties', display: 'Correctness Properties', severity: 'warning', rule: 'design/missing-correctness-properties' },
  { name: 'fix implementation', display: 'Fix Implementation', severity: 'error', rule: 'design/missing-fix-implementation' },
  { name: 'testing strategy', display: 'Testing Strategy', severity: 'warning', rule: 'design/missing-testing-strategy' },
];

/**
 * Validate design.md. Without an explicit spec type, a design that carries the
 * bugfix headings is validated as a bugfix design (Kiro's own heuristic).
 * @param {string} text
 * @param {'feature'|'bugfix'|'quick-spec'} [specType]
 */
export function validateDesign(text, specType) {
  const found = [];
  const rows = lines(text);
  const bugfix = specType === 'bugfix'
    || (specType === undefined && rows.some((line) => /^##\s+Bug Details$/iu.test(line.trimEnd())
      || /^##\s+Hypothesized Root Cause$/iu.test(line.trimEnd())
      || /^##\s+Fix Implementation$/iu.test(line.trimEnd())
      || /^###\s+(Bug|Fault) Condition$/iu.test(line.trimEnd())));
  const sections = bugfix ? BUGFIX_DESIGN_SECTIONS : FEATURE_DESIGN_SECTIONS;
  for (const section of sections) {
    const present = rows.some((row) => {
      const match = /^##\s+(.+)$/u.exec(row.trimEnd());
      return match !== null && match[1].toLowerCase() === section.name;
    });
    if (!present) {
      const label = section.severity === 'error' ? 'required' : 'recommended';
      found.push(issue(section.severity, `Missing ${label} section: ## ${section.display}`, section.rule));
    }
  }
  const headingIndex = rows.findIndex((row) => /^## Correctness Properties$/u.test(row.trimEnd()));
  if (headingIndex !== -1) {
    let end = rows.length;
    for (let cursor = headingIndex + 1; cursor < rows.length; cursor += 1) {
      if (/^## /u.test(rows[cursor])) {
        end = cursor;
        break;
      }
    }
    const block = rows.slice(headingIndex + 1, end);
    const good = /^(?:### )?Property \d+:/u;
    const loose = /^(?:### )?Property\b/u;
    const properties = [];
    for (let cursor = 0; cursor < block.length; cursor += 1) {
      const row = block[cursor];
      if (loose.test(row) && !good.test(row)) {
        found.push(issue('error', 'Malformed property heading. Expected format: Property N: Title or ### Property N: Title', 'design/malformed-property-heading', headingIndex + 1 + cursor));
      }
      if (good.test(row)) properties.push({ index: cursor, line: headingIndex + 1 + cursor });
    }
    if (properties.length === 0) {
      found.push(issue('warning', 'Correctness Properties section has no properties. Expected at least one Property N: heading', 'design/empty-correctness-properties', headingIndex));
    }
    for (let cursor = 0; cursor < properties.length; cursor += 1) {
      const start = properties[cursor].index + 1;
      const stop = cursor + 1 < properties.length ? properties[cursor + 1].index : block.length;
      const body = block.slice(start, stop);
      if (!body.some((row) => /\*\*Validates:\s*Requirements\s+[\d.,\s]+\*\*/u.test(row))) {
        found.push(issue('warning', 'Property is missing **Validates: Requirements X.Y** reference', 'design/missing-property-validates', properties[cursor].line));
      }
    }
  }
  return found;
}

/**
 * Validate tasks.md, including the checkbox grammar and the dependency graph.
 * @param {string} text
 * @param {'feature'|'bugfix'|'quick-spec'} [specType]
 */
export function validateTasks(text, specType) {
  const found = [];
  const rows = lines(text);
  if (!rows.some((row) => /^# Implementation Plan/u.test(row))) {
    found.push(issue('error', 'Missing required heading: # Implementation Plan:', 'tasks/missing-implementation-plan'));
  }
  if (!rows.some((row) => /^## Overview$/u.test(row.trimEnd()))) {
    found.push(issue('warning', 'Missing recommended section: ## Overview', 'tasks/missing-overview'));
  }
  const tasksIndex = rows.findIndex((row) => /^## Tasks$/u.test(row.trimEnd()));
  if (tasksIndex === -1) {
    found.push(issue('warning', 'Missing recommended section: ## Tasks', 'tasks/missing-tasks-section'));
  }
  const headingTask = /^#{2,3} Task \d+/u;
  for (let index = 0; index < rows.length; index += 1) {
    if (headingTask.test(rows[index])) {
      found.push(issue('error', 'Tasks must use checkbox format (- [ ] N. Description), not ## or ### headings', 'tasks/invalid-task-heading', index));
    }
  }
  if (tasksIndex !== -1) {
    let end = rows.length;
    for (let cursor = tasksIndex + 1; cursor < rows.length; cursor += 1) {
      if (/^## /u.test(rows[cursor])) {
        end = cursor;
        break;
      }
    }
    const topTask = /^- \[([ x~-])\]\\?\*? \d+\./u;
    const subTask = /^\s*- \[([ x~-])\]\\?\*? \d+\.\d+/u;
    const anyCheckbox = /^\s*- \[([ x~-])\]/u;
    const malformed = /^\s*- \[([^\] ])\]/u;
    for (let cursor = tasksIndex + 1; cursor < end; cursor += 1) {
      const row = rows[cursor];
      if (malformed.test(row) && !anyCheckbox.test(row)) {
        found.push(issue('error', 'Malformed checkbox. Use - [ ] (unchecked) or - [x] (checked, lowercase)', 'tasks/malformed-checkbox', cursor));
        continue;
      }
      if (!anyCheckbox.test(row)) continue;
      const indent = /^(\s*)/u.exec(row)?.[1].length ?? 0;
      if (indent === 0) {
        if (subTask.test(row)) continue;
        if (!topTask.test(row)) {
          found.push(issue('error', 'Task line does not match expected format: - [ ] N. or - [x] N.', 'tasks/invalid-task-line', cursor));
        }
      } else if (!subTask.test(row)) {
        found.push(issue('error', 'Sub-task line does not match expected format: - [ ] N.M or - [x] N.M', 'tasks/invalid-subtask-line', cursor));
      }
    }
  }
  if (!rows.some((row) => /^## Notes$/u.test(row.trimEnd()))) {
    found.push(issue('warning', 'Missing recommended section: ## Notes', 'tasks/missing-notes'));
  }
  const graphIndex = rows.findIndex((row) => /^## Task Dependency Graph$/u.test(row.trimEnd()));
  if (graphIndex === -1 && specType !== 'bugfix') {
    found.push(issue('error', 'Missing required section: ## Task Dependency Graph.', 'tasks/missing-dependency-graph'));
  } else if (graphIndex !== -1 && specType === 'bugfix') {
    found.push(issue('error', 'A Task Dependency Graph does not belong in a bugfix task list (bugfix tasks run as a linear sequence). Remove the ## Task Dependency Graph section.', 'tasks/bugfix-unexpected-dag', graphIndex));
  } else if (graphIndex !== -1) {
    let end = rows.length;
    for (let cursor = graphIndex + 1; cursor < rows.length; cursor += 1) {
      if (/^## /u.test(rows[cursor])) {
        end = cursor;
        break;
      }
    }
    const block = rows.slice(graphIndex + 1, end).join('\n');
    if (!/```json[\s\S]*?```/u.test(block)) {
      found.push(issue('error', 'Task Dependency Graph section is missing a JSON code block with wave definitions.', 'tasks/missing-dag-json', graphIndex));
    } else {
      const match = /```json\s*\n?([\s\S]*?)```/u.exec(block);
      const body = match ? match[1].trim() : '';
      if (body === '') {
        found.push(issue('error', 'Task Dependency Graph JSON block is empty.', 'tasks/empty-dag-json', graphIndex));
      } else {
        try {
          const parsed = JSON.parse(body);
          if (!parsed || !Array.isArray(parsed.waves) || parsed.waves.length === 0) {
            found.push(issue('error', 'Task Dependency Graph must contain a non-empty "waves" array.', 'tasks/invalid-dag-structure', graphIndex));
          }
        } catch {
          found.push(issue('error', 'Task Dependency Graph contains invalid JSON.', 'tasks/invalid-dag-json', graphIndex));
        }
      }
    }
  }
  return found;
}

const BUGFIX_REQUIRED = [
  { pattern: /^## Introduction$/u, display: '## Introduction', rule: 'bugfix/missing-introduction' },
  { pattern: /^## Bug Analysis$/u, display: '## Bug Analysis', rule: 'bugfix/missing-bug-analysis' },
  { pattern: /^### Current Behavior \(Defect\)$/u, display: '### Current Behavior (Defect)', rule: 'bugfix/missing-current-behavior' },
  { pattern: /^### Expected Behavior \(Correct\)$/u, display: '### Expected Behavior (Correct)', rule: 'bugfix/missing-expected-behavior' },
  { pattern: /^### Unchanged Behavior \(Regression Prevention\)$/u, display: '### Unchanged Behavior (Regression Prevention)', rule: 'bugfix/missing-unchanged-behavior' },
];
const DESIGN_ONLY_SECTIONS = [/technical context/iu, /implementation details/iu, /architecture/iu, /components and interfaces/iu, /data models/iu];

/** Validate bugfix.md. */
export function validateBugfix(text) {
  const found = [];
  const rows = lines(text);
  for (const section of BUGFIX_REQUIRED) {
    if (!rows.some((row) => section.pattern.test(row.trimEnd()))) {
      found.push(issue('error', `Missing required section: ${section.display}`, section.rule));
    }
  }
  for (let index = 0; index < rows.length; index += 1) {
    const match = /^#{2,3}\s+(.+)$/u.exec(rows[index].trimEnd());
    if (match === null) continue;
    const heading = match[1];
    if (DESIGN_ONLY_SECTIONS.some((pattern) => pattern.test(heading))) {
      found.push(issue('warning', `Section "${heading}" is a design-only section and does not belong in a bugfix document`, 'bugfix/unexpected-section', index, { heading }));
    }
  }
  return found;
}

/**
 * Dispatch to the right validator.
 * @param {string} text
 * @param {'requirements'|'design'|'tasks'|'bugfix'} kind
 * @param {'feature'|'bugfix'|'quick-spec'} [specType]
 */
export function validateDocument(text, kind, specType) {
  switch (kind) {
    case 'requirements': return validateRequirements(text);
    case 'design': return validateDesign(text, specType);
    case 'tasks': return validateTasks(text, specType);
    case 'bugfix': return validateBugfix(text);
    default: return [];
  }
}

/* ------------------------------------------------------------------------- *
 * EARS / INCOSE semantic checks (beyond Kiro's structural validator)
 * ------------------------------------------------------------------------- */

const EARS_KEYWORDS = /\b(WHEN|WHILE|IF|WHERE|THE|SHALL|SHALL NOT|SHALL CONTINUE TO|FOR ALL)\b/u;
const VAGUE = /\b(handle|support|process|manage|appropriate|robust|user-friendly|as needed|where possible|etc\.?|and so on)\b/iu;

/**
 * Semantic checks on requirement clauses. Structural validity is Kiro's
 * business; these findings catch the quality problems its validator leaves to
 * the model (escape clauses, missing SHALL, compound criteria, vague verbs).
 *
 * @param {string} text - requirements.md or bugfix.md
 * @returns {Array<{severity: string, message: string, line: number, rule: string}>}
 */
export function lintRequirementsSemantics(text) {
  const found = [];
  const rows = lines(text);
  let inAcceptance = false;
  let requirement = '';
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const requirementHeading = /^### Requirement (\d+):\s*(.*)$/u.exec(row.trimEnd());
    if (requirementHeading !== null) {
      requirement = requirementHeading[1];
      inAcceptance = false;
      continue;
    }
    if (/^#### Acceptance Criteria$/iu.test(row.trimEnd())) {
      inAcceptance = true;
      continue;
    }
    if (/^###? /u.test(row)) {
      inAcceptance = false;
      continue;
    }
    if (!inAcceptance) continue;
    const clause = /^\s*(\d+)\.\s+(.*)$/u.exec(row);
    if (clause === null) continue;
    const body = clause[2].trim();
    if (body === '') continue;
    const where = `Requirement ${requirement}, criterion ${clause[1]}`;
    // Template placeholders (`THE [System_Name] SHALL [response]`) are scaffolding,
    // not requirements: semantic linting starts once the brackets are gone.
    if (/\[[^\]]+\]/u.test(body)) continue;
    if (!EARS_KEYWORDS.test(body)) {
      found.push(issue('warning', `${where} is not in an EARS pattern (WHEN/WHILE/IF/WHERE … SHALL …)`, 'ears/missing-pattern', index, { where }));
    }
    if (!/\bSHALL\b/u.test(body)) {
      found.push(issue('warning', `${where} has no SHALL clause`, 'ears/missing-shall', index, { where }));
    }
    if (VAGUE.test(body)) {
      found.push(issue('warning', `${where} uses a vague or escape-clause verb ("${body.match(VAGUE)?.[0]}"); state an observable response`, 'ears/vague-verb', index, { where, verb: body.match(VAGUE)?.[0] }));
    }
    if (/\band\b/iu.test(body) && (body.match(/\bSHALL\b/gu) ?? []).length > 1) {
      found.push(issue('info', `${where} contains multiple SHALL clauses; consider splitting it`, 'ears/compound-criterion', index, { where }));
    }
  }
  return found;
}

/** Extract `**Validates: Requirements X.Y**` references from a design. */
export function parseValidates(text) {
  const refs = [];
  for (const match of String(text ?? '').matchAll(/\*\*Validates:\s*Requirements\s+([\d.,\s]+)\*\*/gu)) {
    for (const part of match[1].split(',')) {
      const value = part.trim();
      if (/^\d+(?:\.\d+)*$/u.test(value)) refs.push(value);
    }
  }
  return refs;
}
