/**
 * Guard: the whole-arguments example embedded in the parameters schema must stay a
 * parseable, correctly nested JSON document.
 *
 * Why this is a separate file: test/policy-section.mjs deliberately asserts only the
 * verbatim substrings fixed by the SPEC and never free wording. The schema example is
 * free wording, so its *shape* needs its own guard — otherwise the exact defect this
 * guard exists for comes back silently: an example that looks like JSON but cannot be
 * parsed, which teaches the model the wrong nesting instead of the right one.
 *
 * History this locks down (verified byte-by-byte against interruped turns): four
 * turn-level failures all came from `questions -> key -> spec` nesting, e.g.
 * `{"questions":{"criteria":{...},"instructions":...}}` with the question key missing,
 * or `instructions`/`type` sitting beside `questions` instead of inside the key.
 * A `{...}` placeholder cannot show that level, so the example must stay complete.
 *
 * Run: node test/schema-shape.mjs
 */
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

const ctx = {
  tools: {
    register(definition) {
      ctx.registered = definition;
      return () => {};
    },
  },
  inject() {
    return () => {};
  },
  systemPrompt: { getSectionOrder: () => 3110, section: () => () => {} },
};
apply(ctx, {});

const description = ctx.registered?.parameters?.properties?.questions?.description ?? '';
check('the questions schema carries a description', description.length > 0, String(description.length));

const start = description.indexOf('{"state"');
check('the description carries a whole-arguments example', start !== -1, description.slice(0, 120));

/** Take the balanced JSON object starting at `start`, stopping at its matching brace. */
function balancedObject(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const sample = start === -1 ? null : balancedObject(description, start);
check('the example is a complete JSON object', sample !== null && sample.endsWith('}'), String(sample).slice(0, 80));

let parsed = null;
try {
  parsed = JSON.parse(sample ?? '');
  check('the example parses as JSON', true);
} catch (error) {
  check('the example parses as JSON', false, error instanceof Error ? error.message : String(error));
}

if (parsed !== null) {
  check(
    'the example keeps state and questions as siblings at the root',
    Object.keys(parsed).sort().join(',') === 'questions,state',
    JSON.stringify(Object.keys(parsed)),
  );
  check(
    'questions in the example is an object, not an array',
    parsed.questions !== null && typeof parsed.questions === 'object' && !Array.isArray(parsed.questions),
    Array.isArray(parsed.questions) ? 'array' : typeof parsed.questions,
  );

  const keyNames = parsed.questions && typeof parsed.questions === 'object' ? Object.keys(parsed.questions) : [];
  check('the example shows exactly one self-named question key', keyNames.length === 1, JSON.stringify(keyNames));

  const spec = keyNames.length === 1 ? parsed.questions[keyNames[0]] : null;
  check(
    'the spec sits inside the question key (not beside questions)',
    spec !== null && typeof spec === 'object' && !Array.isArray(spec),
    typeof spec,
  );
  check(
    'the example carries type and instructions inside that key',
    spec !== null && typeof spec.type === 'string' && typeof spec.instructions === 'string',
    JSON.stringify(spec && Object.keys(spec)),
  );
}

check(
  'no placeholder braces remain in the example (the `{...}` defect)',
  sample !== null && !sample.includes('{...}'),
  String(sample).slice(0, 80),
);

if (failures > 0) {
  console.log('\nSCHEMA SHAPE FAILED (' + failures + ')');
  process.exit(1);
}
console.log('\nSCHEMA SHAPE OK');
