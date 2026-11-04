/**
 * Kiro-compatible format validation tests.
 *
 * The expectations are transcribed from Kiro's own validator (rule codes,
 * severity, grammar) as extracted from kiroAgent 1.1.530, so these tests pin
 * compatibility rather than an invented contract.
 *
 * Run: node --test test/validate.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lintRequirementsSemantics,
  parseValidates,
  validateBugfix,
  validateDesign,
  validateRequirements,
  validateTasks,
} from '../lib/validate.js';
import {
  bugfixDesignTemplate,
  bugfixTasksTemplate,
  bugfixTemplate,
  designTemplate,
  documentSet,
  requirementsTemplate,
  tasksTemplate,
} from '../lib/templates.js';

const rules = (issues) => issues.map((issue) => issue.rule);

test('the official requirements template passes the requirements validator', () => {
  assert.deepEqual(validateRequirements(requirementsTemplate()), []);
});

test('requirements validation reports Kiro rule codes', () => {
  const empty = validateRequirements('');
  assert.deepEqual(
    rules(empty),
    [
      'requirements/missing-title',
      'requirements/missing-introduction',
      'requirements/missing-glossary',
      'requirements/missing-requirements-section',
    ],
  );
  assert.equal(empty[0].severity, 'error');
  assert.equal(empty[2].severity, 'warning');

  const malformed = validateRequirements(`# Requirements Document

## Introduction

x

## Requirements

### Requirement One

**User Story:** As a user, I want it.

#### Acceptance Criteria

1. WHEN x, THE System SHALL y
`);
  assert.ok(rules(malformed).includes('requirements/malformed-requirement-heading'));

  const noCriteria = validateRequirements(`# Requirements Document

## Introduction

x

## Requirements

### Requirement 1: Thing

**User Story:** As a user, I want it.
`);
  assert.ok(rules(noCriteria).includes('requirements/missing-acceptance-criteria'));
});

test('the official design template passes the design validator', () => {
  assert.deepEqual(validateDesign(designTemplate('Feature')), []);
});

test('design validation detects missing sections and malformed properties', () => {
  const issues = validateDesign(`# Design Document: X

## Overview

x

## Architecture

x

## Components and Interfaces

x

## Data Models

x

## Correctness Properties

Property one is malformed

## Testing Strategy

x
`);
  const found = rules(issues);
  assert.ok(found.includes('design/missing-error-handling'));
  assert.ok(found.includes('design/malformed-property-heading'));
  assert.ok(found.includes('design/empty-correctness-properties'));
});

test('design validator reports properties without Validates references', () => {
  const issues = validateDesign(`# Design Document: X

## Overview

x

## Architecture

x

## Components and Interfaces

x

## Data Models

x

## Correctness Properties

### Property 1: Round trip

For any value, encode then decode returns it.

## Error Handling

x

## Testing Strategy

x
`);
  assert.ok(rules(issues).includes('design/missing-property-validates'));
});

test('bugfix design uses the bugfix section set', () => {
  assert.deepEqual(validateDesign(bugfixDesignTemplate('Bug'), 'bugfix'), []);
  const missing = validateDesign('# X\n\n## Overview\n\nx\n', 'bugfix');
  const found = rules(missing);
  assert.ok(found.includes('design/missing-bug-details'));
  assert.ok(found.includes('design/missing-hypothesized-root-cause'));
  assert.ok(found.includes('design/missing-fix-implementation'));
});

test('bugfix requirements validator rejects design-only sections', () => {
  assert.deepEqual(validateBugfix(bugfixTemplate('Bug')), []);
  const leaked = validateBugfix(`# Bugfix Requirements Document

## Introduction

x

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN x THEN the system y

### Expected Behavior (Correct)

2.1 WHEN x THEN the system SHALL y

### Unchanged Behavior (Regression Prevention)

3.1 WHEN x THEN the system SHALL CONTINUE TO y

## Technical Context

x
`);
  assert.ok(rules(leaked).includes('bugfix/unexpected-section'));
});

test('the official tasks template passes the tasks validator', () => {
  assert.deepEqual(validateTasks(tasksTemplate('Feature')), []);
});

test('bugfix tasks must not contain a dependency graph', () => {
  assert.deepEqual(validateTasks(bugfixTasksTemplate('Bug'), 'bugfix'), []);
  const withGraph = `${bugfixTasksTemplate('Bug')}

## Task Dependency Graph

\`\`\`json
{ "waves": [{ "id": 0, "tasks": ["1.1"] }] }
\`\`\`
`;
  assert.ok(rules(validateTasks(withGraph, 'bugfix')).includes('tasks/bugfix-unexpected-dag'));
});

test('task checkbox grammar matches Kiro, including optional markers', () => {
  const badCheckbox = validateTasks(`# Implementation Plan: X

## Overview

x

## Tasks

- [X] 1. Capitalized box
  - _Requirements: 1.1_

- [ ] 2. Parent
  - [ ]* 2.1 Optional child
    - _Requirements: 1.1_

## Notes

x

## Task Dependency Graph

\`\`\`json
{ "waves": [{ "id": 0, "tasks": ["1", "2.1"] }] }
\`\`\`
`, 'feature');
  assert.deepEqual(rules(badCheckbox), ['tasks/malformed-checkbox']);
});

test('task validator requires the dependency graph and its JSON block', () => {
  const missingGraph = validateTasks(`# Implementation Plan: X

## Overview

x

## Tasks

- [ ] 1. Do
  - _Requirements: 1.1_

## Notes

x
`);
  assert.ok(rules(missingGraph).includes('tasks/missing-dependency-graph'));

  const badJson = validateTasks(`# Implementation Plan: X

## Overview

x

## Tasks

- [ ] 1. Do
  - _Requirements: 1.1_

## Notes

x

## Task Dependency Graph

\`\`\`json
{ "waves": [] }
\`\`\`
`);
  assert.ok(rules(badJson).includes('tasks/invalid-dag-structure'));
});

test('EARS semantic checks catch vague verbs and missing SHALL', () => {
  const text = `# Requirements Document

## Introduction

x

## Requirements

### Requirement 1: Things

**User Story:** As a user, I want it.

#### Acceptance Criteria

1. The system should handle errors where possible
2. WHEN x, THE System SHALL do it
`;
  const found = rules(lintRequirementsSemantics(text));
  assert.ok(found.includes('ears/missing-pattern'));
  assert.ok(found.includes('ears/missing-shall'));
  assert.ok(found.includes('ears/vague-verb'));
});

test('Kiro-localized requirement headings are parsed (real-world specs use 需求 N：)', async () => {
  const { parseRequirements } = await import('../lib/model.js');
  const parsed = parseRequirements(`# Requirements Document

## Introduction

x

## Requirements

### 需求 1：中文标题

**用户故事：** 作为用户，我希望更快。

#### 验收标准

1. 当用户登录时，系统应在 2 秒内响应
2. 系统应记录失败次数
`, 'feature');
  assert.equal(parsed.requirements.length, 1);
  assert.equal(parsed.requirements[0].id, '1');
  assert.equal(parsed.requirements[0].title, '中文标题');
  assert.equal(parsed.requirements[0].acceptance.length, 2);
  assert.equal(parsed.clauses[0].id, '1.1');
});

test('parseValidates extracts clause references from properties', () => {
  const refs = parseValidates('**Validates: Requirements 1.1, 2.3**\n**Validates: Requirements 4.2**');
  assert.deepEqual(refs, ['1.1', '2.3', '4.2']);
});

test('documentSet picks bugfix documents for bugfix specs', () => {
  const bugfix = documentSet({ feature: 'Fix it', specType: 'bugfix' });
  assert.match(bugfix.requirements, /^# Bugfix Requirements Document/u);
  assert.match(bugfix.tasks, /^# Implementation Plan: Fix it/u);
  assert.doesNotMatch(bugfix.tasks, /^## Task Dependency Graph$/mu);
  const feature = documentSet({ feature: 'Ship it', specType: 'feature' });
  assert.match(feature.requirements, /^# Requirements Document/u);
  assert.match(feature.tasks, /## Task Dependency Graph/u);
});
