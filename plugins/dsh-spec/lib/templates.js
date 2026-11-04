/**
 * dsh-spec — Kiro-compatible templates.
 *
 * These are the exact document scaffolds Kiro's spec workflow hands to its
 * sub-agents (extracted from kiroAgent 1.1.530, `dist/extension.js`), kept as
 * data so `spec_create` can materialize a skeleton whose headings, section
 * order and checkbox grammar the validator accepts on the first try.
 *
 * @module dsh-spec/templates
 */

/** Placeholder used for the spec title inside generated documents. */
export const FEATURE_PLACEHOLDER = '[Feature Name]';

/** requirements.md template (Feature, requirements-first/design-first/fast-task). */
export function requirementsTemplate(feature = FEATURE_PLACEHOLDER) {
  return `# Requirements Document

## Introduction

[Summary of the feature/system. Replace this paragraph with the problem, who it serves, and what changes.]

## Glossary

- **${feature}**: [Definition]
- **System**: [The system this specification describes]

## Requirements

### Requirement 1:

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. WHEN [event], THE [System_Name] SHALL [response]
2. WHILE [state], THE [System_Name] SHALL [response]
3. IF [undesired event], THEN THE [System_Name] SHALL [response]
4. WHERE [optional feature], THE [System_Name] SHALL [response]

### Requirement 2:

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. THE [System_Name] SHALL [response]
2. WHEN [event], THE [System_Name] SHALL [response]
`;
}

/** bugfix.md template (Bugfix spec type). */
export function bugfixTemplate(feature = FEATURE_PLACEHOLDER) {
  return `# Bugfix Requirements Document

## Introduction

[Summary of the bug being fixed, the ${feature} impact, and the observable symptoms.]

## Bug Analysis

### Current Behavior (Defect)

[What currently happens when the bug is triggered]

1.1 WHEN [condition] THEN the system [incorrect behavior]
1.2 WHEN [condition] THEN the system [incorrect behavior]

### Expected Behavior (Correct)

[What should happen instead]

2.1 WHEN [condition] THEN the system SHALL [correct behavior]
2.2 WHEN [condition] THEN the system SHALL [correct behavior]

### Unchanged Behavior (Regression Prevention)

[Existing behavior that must be preserved]

3.1 WHEN [condition] THEN the system SHALL CONTINUE TO [existing behavior]
3.2 WHEN [condition] THEN the system SHALL CONTINUE TO [existing behavior]
`;
}

/** design.md template (Feature). */
export function designTemplate(feature = FEATURE_PLACEHOLDER) {
  return `# Design Document: ${feature}

## Overview

[2-3 paragraph summary of the feature, its purpose, and high-level approach]

## Architecture

[Describe the overall architecture. Include Mermaid diagrams where helpful]

\`\`\`mermaid
graph TD
    A[Component A] --> B[Component B]
    B --> C[Component C]
\`\`\`

## Components and Interfaces

### Component 1: [Name]

**Purpose**: [What this component does]

**Interface**:
\`\`\`[language or pseudocode]
interface ComponentName {
  method1(param: Type): ReturnType
  method2(param: Type): ReturnType
}
\`\`\`

**Responsibilities**:
- Responsibility 1
- Responsibility 2

## Data Models

### Model 1: [Name]

\`\`\`[language or pseudocode]
interface ModelName {
  field1: Type
  field2: Type
  field3: Type
}
\`\`\`

**Validation Rules**:
- Rule 1
- Rule 2

## Correctness Properties

[Every property is universally quantified and annotated with the requirements it validates.]

### Property 1: [Title]

_For any_ [input or state], the system SHALL [invariant, round-trip, idempotence, metamorphic, or error-condition property].

**Validates: Requirements 1.1**

### Property 2: [Title]

_For any_ [input or state], the system SHALL [property].

**Validates: Requirements 1.2**

## Error Handling

### Error Scenario 1: [Name]

**Condition**: [When this error occurs]
**Response**: [How the system handles it]
**Recovery**: [How the system recovers]

## Testing Strategy

### Unit Testing Approach

[Describe unit testing strategy, key test cases, and coverage goals]

### Property-Based Testing Approach

[Describe property-based testing strategy]

**Property Test Library**: [Specify library: fast-check, hypothesis, QuickCheck, etc.]

### Integration Testing Approach

[Describe integration testing strategy if applicable]

## Dependencies

[List external dependencies, libraries, or services required]
`;
}

/** design.md template (Bugfix). */
export function bugfixDesignTemplate(feature = FEATURE_PLACEHOLDER) {
  return `# ${feature} Bugfix Design

## Overview

[High-level description of the bug, its impact, and the general strategy for fixing it.]

## Glossary

- **Bug_Condition (C)**: [The condition that triggers the bug]
- **Property (P)**: [The desired behavior when the bug condition holds]
- **Preservation**: [Existing behavior that must remain unchanged by the fix]

## Bug Details

### Bug Condition

The bug manifests when [description of when the bug occurs]. The [function/component name] is either [possible cause 1], [possible cause 2], or [possible cause 3].

**Formal Specification:**
\`\`\`
FUNCTION isBugCondition(input)
  INPUT: input of type [InputType]
  OUTPUT: boolean

  RETURN input.[property] IN [valid values]
         AND [additional condition]
         AND [expected behavior] is not triggered
END FUNCTION
\`\`\`

### Examples

- [Concrete example 1 with expected vs actual behavior]
- [Concrete example 2 with expected vs actual behavior]
- [Edge case example - expected behavior]

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- [Existing behavior 1 that must continue to work]
- [Existing behavior 2 that must continue to work]

**Scope:**
All inputs that do NOT involve [bug condition] should be completely unaffected by this fix. This includes:
- [Non-affected input type 1]
- [Non-affected input type 2]

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **[Root Cause Category 1]**: [Description of potential issue]
2. **[Root Cause Category 2]**: [Description of potential issue]
3. **[Root Cause Category 3]**: [Description of potential issue]

## Correctness Properties

### Property 1: Bug Condition - [Bug title]

_For any_ input where the bug condition holds (isBugCondition returns true), the fixed function SHALL [expected correct behavior].

**Validates: Requirements 2.1, 2.2**

### Property 2: Preservation - [Preservation title]

_For any_ input where the bug condition does NOT hold (isBugCondition returns false), the fixed function SHALL produce the same result as the original function, preserving [description of preserved behavior].

**Validates: Requirements 3.1, 3.2**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: \`[file path]\`

**Function**: \`[function name]\`

**Specific Changes**:
1. **[Change Category 1]**: [Description of change]
2. **[Change Category 2]**: [Description of change]
3. **[Change Category 3]**: [Description of change]

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write tests that [description of test approach]. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **[Test Name 1]**: [Test description] (will fail on unfixed code)
2. **[Test Name 2]**: [Test description] (will fail on unfixed code)

**Expected Counterexamples**:
- [Expected failure pattern 1]
- Possible causes: [cause 1], [cause 2]

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
\`\`\`
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
\`\`\`

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
\`\`\`
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
\`\`\`

**Testing Approach**: Property-based testing is recommended for preservation checking.

### Unit Tests

- [Unit test category 1]
- [Unit test category 2]

### Property-Based Tests

- [Property test 1 - generates random inputs to verify correctness]
- [Property test 2 - generates random configurations to verify preservation]

### Integration Tests

- [Integration test 1 - full flow testing]
`;
}

/** tasks.md template (Feature). */
export function tasksTemplate(feature = FEATURE_PLACEHOLDER) {
  return `# Implementation Plan: ${feature}

## Overview

[Brief description of the implementation approach, derived from design.md]

## Tasks

- [ ] 1. Set up project structure and core interfaces
  - Create directory structure
  - Define core interfaces and types
  - _Requirements: 1.1_

- [ ] 2. Implement core functionality
  - [ ] 2.1 Implement [Component A]
    - Write implementation for core logic
    - _Requirements: 1.1, 1.2_

  - [ ]* 2.2 Write property test for [Component A]
    - **Property 1: [Property Title]**
    - **Validates: Requirements 1.1**

  - [ ] 2.3 Implement [Component B]
    - Write implementation for supporting logic
    - _Requirements: 1.2_

  - [ ]* 2.4 Write unit tests for [Component B]
    - Test edge cases and error conditions
    - _Requirements: 1.2_

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Integration and wiring
  - [ ] 4.1 Wire components together
    - Connect all components
    - _Requirements: 1.1, 1.2_

  - [ ]* 4.2 Write integration tests
    - Test end-to-end flows
    - _Requirements: 1.1, 1.2_

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with \`*\` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases

## Task Dependency Graph

\`\`\`json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "4.2"] }
  ]
}
\`\`\`
`;
}

/** tasks.md template (Bugfix). Bugfix task lists run linearly and omit the DAG. */
export function bugfixTasksTemplate(feature = FEATURE_PLACEHOLDER) {
  return `# Implementation Plan: ${feature}

## Overview

[Bugfix implementation plan: exploratory test, fix, then preservation checks]

## Tasks

- [ ] 1. Write Bug Condition exploration test on unfixed code
  - **Property 1: Bug Condition** - [Condition summary]
  - Reproduce the defect and record the counterexample
  - _Requirements: 1.1_

- [ ] 2. Write behavior preservation tests on unfixed code
  - **Property 2: Preservation** - [Preserved behavior summary]
  - Observe current behavior for non-buggy inputs and capture it
  - _Requirements: 3.1_

- [ ] 3. Fix the bug condition
  - [ ] 3.1 Implement the fix
    - _Requirements: 2.1_

  - [ ] 3.2 Re-run the exploration test and confirm it passes
    - _Requirements: 2.1_

  - [ ] 3.3 Re-run the preservation tests and confirm they pass
    - _Requirements: 3.1_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Bugfix task lists run as a linear sequence; a Task Dependency Graph is not used
- Exploration tests must fail before the fix and pass after it
- Preservation tests must pass before and after the fix
`;
}

/** Render the three/four documents for one spec skeleton. */
export function documentSet({ feature, specType = 'feature', workflowType = 'requirements-first' }) {
  const bugfix = specType === 'bugfix';
  const featureInput = feature || FEATURE_PLACEHOLDER;
  return {
    requirements: bugfix ? bugfixTemplate(featureInput) : requirementsTemplate(featureInput),
    design: bugfix ? bugfixDesignTemplate(featureInput) : designTemplate(featureInput),
    tasks: bugfix ? bugfixTasksTemplate(featureInput) : tasksTemplate(featureInput),
    workflowType,
    specType,
  };
}

/** File name that holds the requirements-side document for a spec type. */
export function requirementsFileName(specType) {
  return specType === 'bugfix' ? 'bugfix.md' : 'requirements.md';
}
