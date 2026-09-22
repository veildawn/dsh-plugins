/**
 * Trigger-policy tests for dsh-plugin-jev (SPEC specs/feature-jev-trigger-policy.yaml).
 *
 * Covers the plugin-layer self-trigger contract: the policy text anchors on the
 * jev_decide description (A) and the optional, deferred registration of the
 * "jev-decision-policy" prompt section through ctx.inject(['systemPrompt'], cb) (B).
 *
 * Everything happens against a fake ctx and the real module exports: zero
 * dependencies, no DSH process, no API key, and no network request. The fake ctx
 * mirrors the registration surface smoke.mjs already uses (tools.register) and
 * adds the two systemPrompt members the section path needs (getSectionOrder,
 * section). `inject` records the callback instead of running it, so a test can
 * drive the deferred path explicitly with flush().
 *
 * Verification anchors are the verbatim substrings fixed by the SPEC
 * (outputs.schema (1)-(4)); they must not be relaxed to fit an implementation,
 * and no wording the SPEC leaves free is asserted here.
 *
 * Run: node test/policy-section.mjs
 */
import assert from 'node:assert/strict';
import { apply, inject as pluginInject } from '../lib/index.js';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

/**
 * assert.throws with an anchored RegExp tests String(error) ("Error: tool-jev: …"),
 * so an anchored /^tool-jev:/ would never match. Validate the message through a
 * predicate instead: same assertion, meaningful prefix anchor.
 */
function checkThrows(label, fn, pattern) {
  try {
    assert.throws(fn, (error) => error instanceof Error && pattern.test(error.message));
    check(label, true);
  } catch (error) {
    check(label, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
}

/** SECTION_ORDERS values relevant here (SPEC context, verified against the contract). */
const SECTION_ORDERS = { MCP_SERVERS: 3100, TOOLS_SDK: 5000, TEAM_POLICY: 600, HARNESS_IDENTITY: -1000 };

/**
 * Fake ctx. options.orderFor overrides ctx.systemPrompt.getSectionOrder;
 * options.systemPrompt: 'absent' removes the service entirely.
 */
function makeCtx(options = {}) {
  const state = { tools: [], sections: [], injections: [], orderQueries: [] };
  const orderFor =
    options.orderFor ??
    ((name) => {
      if (!(name in SECTION_ORDERS)) throw new Error('unknown section order: ' + name);
      return SECTION_ORDERS[name];
    });

  const ctx = {
    tools: {
      register(definition) {
        state.tools.push(definition);
        return () => {};
      },
    },
    inject(services, callback) {
      state.injections.push({ services: [...services], callback });
      return () => {};
    },
  };

  if (options.systemPrompt !== 'absent') {
    ctx.systemPrompt = {
      getSectionOrder(sectionName) {
        state.orderQueries.push(sectionName);
        return orderFor(sectionName);
      },
      section(section) {
        state.sections.push(section);
        return () => {};
      },
    };
  }

  /** Run every recorded inject callback whose services are available (the deferred path). */
  state.flush = () => {
    let invoked = 0;
    for (const injection of [...state.injections]) {
      if (!injection.services.every((service) => ctx[service] !== undefined)) continue;
      state.injections.splice(state.injections.indexOf(injection), 1);
      injection.callback(ctx);
      invoked += 1;
    }
    return invoked;
  };

  state.ctx = ctx;
  return state;
}

function register(config) {
  const fake = makeCtx();
  apply(fake.ctx, config);
  return { fake, tools: fake.tools };
}

/** Section text when the implementation registered a string, else ''. */
const textOf = (section) => (typeof section?.text === 'string' ? section.text : '');

// --- AC2 (normal path B): deferred ctx.inject(['systemPrompt']) registration ---
const deferred = makeCtx();
apply(deferred.ctx, {});

check(
  'AC2 inject-path: apply records exactly one ctx.inject(["systemPrompt"], cb) (SPEC outputs.schema(4))',
  deferred.injections.length === 1 && deferred.injections[0].services.join(',') === 'systemPrompt',
  JSON.stringify(deferred.injections.map((entry) => entry.services)),
);
check(
  'AC2 inject-path: the section is deferred, not registered eagerly inside apply()',
  deferred.sections.length === 0,
  'sections before flush: ' + deferred.sections.length,
);

const invoked = deferred.flush();
const section = deferred.sections[0];

check('AC2 inject-path: the deferred callback registers the section exactly once', invoked === 1 && deferred.sections.length === 1, 'invoked=' + invoked + ' sections=' + deferred.sections.length);
check('AC2 section.name is "jev-decision-policy"', section?.name === 'jev-decision-policy', String(section?.name));
check('AC2 section.interpolate is false', section?.interpolate === false, String(section?.interpolate));
check(
  "AC2 section.order is getSectionOrder('MCP_SERVERS') + 10 by default",
  section?.order === SECTION_ORDERS.MCP_SERVERS + 10,
  String(section?.order),
);
check(
  'AC2 section.text is a string starting with "## Jev decision policy"',
  typeof section?.text === 'string' && section.text.startsWith('## Jev decision policy'),
  textOf(section).slice(0, 80),
);
check('AC2 section.text contains the literal "jev_decide"', textOf(section).includes('jev_decide'), textOf(section).slice(0, 120));
check(
  'AC2 section.text carries the policy anchors "Exempt only when" and "Decision moments" (SPEC outputs.schema(3))',
  textOf(section).includes('Exempt only when') && textOf(section).includes('Decision moments'),
  textOf(section).slice(0, 200),
);
check(
  'AC2 section.text explains the PTC arrival through run_code (SPEC outputs.schema(3))',
  textOf(section).toLowerCase().includes('run_code'),
  textOf(section).slice(0, 200),
);
check(
  'AC2 section object omits "complete" entirely (SPEC outputs.schema(3): must not appear)',
  section !== undefined && !Object.prototype.hasOwnProperty.call(section, 'complete'),
  JSON.stringify(section && Object.keys(section)),
);

// --- AC1 + AC3 + AC8 (normal path A): description anchors and budgets ---------
const { tools: policyTools } = register({});
const description = policyTools[0]?.description ?? '';

check('AC1 description is registered with the jev_decide tool', policyTools.length === 1 && policyTools[0]?.name === 'jev_decide', String(policyTools.length));
for (const anchor of ['When to use', 'Exempt only when', 'Decision moments', 'Budget:']) {
  check('AC1 description contains the policy anchor ' + JSON.stringify(anchor), description.includes(anchor), description.slice(0, 160));
}
// Remaining outputs.schema(1) anchors, also fixed verbatim by the SPEC.
for (const anchor of [
  'Default: ask Jev before turning a judgment about meaning, intent, relevance,',
  'jev_decide',
]) {
  check('AC1 description contains the SPEC outputs.schema(1) anchor ' + JSON.stringify(anchor), description.includes(anchor), description.slice(0, 160));
}
check('AC3 description.length <= 1500', description.length > 0 && description.length <= 1500, 'length=' + description.length);
check('AC3 section text length <= 1200', textOf(section).length > 0 && textOf(section).length <= 1200, 'length=' + textOf(section).length);

// --- AC8 (regression): the pre-existing grammar / return-shape sentences ------
for (const anchor of [
  'Question grammar: choice needs',
  'score needs',
  'the yes/no primitive is',
  'answers[key].choice',
  'answers[key].score',
  'answers[key].noul',
]) {
  check('AC8 description still contains ' + JSON.stringify(anchor), description.includes(anchor), description.slice(0, 160));
}

// --- AC4 (boundary): config.policySection.order overrides the default ---------
const overridden = makeCtx();
apply(overridden.ctx, { policySection: { order: -5000 } });
overridden.flush();
check('AC4 config.policySection.order=-5000 is used verbatim', overridden.sections.length === 1 && overridden.sections[0]?.order === -5000, String(overridden.sections[0]?.order));

// --- AC5 (failure): systemPrompt never provided -------------------------------
const absent = makeCtx({ systemPrompt: 'absent' });
let absentError = null;
try {
  apply(absent.ctx, {});
} catch (error) {
  absentError = error;
}
check('AC5 apply() does not throw when systemPrompt is never provided', absentError === null, absentError === null ? undefined : absentError.message);
check('AC5 tools.register is called exactly once without systemPrompt', absent.tools.length === 1 && absent.tools[0]?.name === 'jev_decide', 'tools=' + absent.tools.length);
check('AC5 no section is registered without systemPrompt', absent.flush() === 0 && absent.sections.length === 0, 'sections=' + absent.sections.length);

// --- AC6 (failure): explicit opt-out ------------------------------------------
const disabled = makeCtx();
apply(disabled.ctx, { policySection: { enabled: false } });
disabled.flush();
check('AC6 enabled=false still registers the tool exactly once', disabled.tools.length === 1 && disabled.tools[0]?.name === 'jev_decide', 'tools=' + disabled.tools.length);
check('AC6 enabled=false registers zero sections', disabled.sections.length === 0, 'sections=' + disabled.sections.length);

// --- AC7 (failure): invalid policySection config ------------------------------
checkThrows(
  'AC7 policySection.enabled="yes" throws an Error starting with "tool-jev:"',
  () => apply(makeCtx().ctx, { policySection: { enabled: 'yes' } }),
  /^tool-jev:/,
);
checkThrows(
  'AC7 policySection.order=NaN throws an Error starting with "tool-jev:"',
  () => apply(makeCtx().ctx, { policySection: { order: Number.NaN } }),
  /^tool-jev:/,
);

// --- ACX (extra, SPEC-grounded): order delegation and fallback ----------------
const stubbed = makeCtx({ orderFor: () => 7777 });
apply(stubbed.ctx, {});
stubbed.flush();
check(
  'ACX order is derived from ctx.systemPrompt.getSectionOrder, not hardcoded',
  stubbed.orderQueries.join(',') === 'MCP_SERVERS' && stubbed.sections[0]?.order === 7787,
  'queries=' + stubbed.orderQueries.join(',') + ' order=' + String(stubbed.sections[0]?.order),
);

const fallback = makeCtx({
  orderFor: () => {
    throw new Error('section orders unavailable');
  },
});
let fallbackError = null;
try {
  apply(fallback.ctx, {});
  fallback.flush();
} catch (error) {
  fallbackError = error;
}
check(
  'ACX a failing getSectionOrder falls back to order 3110 without escaping apply() (SPEC failure_handling)',
  fallbackError === null && fallback.sections.length === 1 && fallback.sections[0]?.order === 3110,
  (fallbackError === null ? '' : fallbackError.message + ' / ') + 'order=' + String(fallback.sections[0]?.order),
);

check('ACX plugin keeps the hard dependency list inject=[\'tools\'] (SPEC outputs.schema(4))', Array.isArray(pluginInject) && pluginInject.join(',') === 'tools', JSON.stringify(pluginInject));

// --- ACX2 (anti-shortcut): A and B must share one policy block -----------------
// SPEC context: the description (A) and the section (B) must be assembled from
// one set of constants and B's body must be based on A's policy block, so a
// section that merely restates the short anchors cannot drift from A. The
// shared sentences are derived from the description side only (no unexported
// internals imported); each derived sentence must appear verbatim in B, so a
// hardcoded "anchors-only" section dies while a genuinely shared block passes.
const collapse = (value) => value.replace(/\s+/g, ' ').trim();
const collapsedDescription = collapse(description);
const policyStart = collapsedDescription.indexOf('When to use');
const policyEnd = collapsedDescription.indexOf('Question grammar');
const sharedPolicyBlock =
  policyStart >= 0 && policyEnd > policyStart ? collapsedDescription.slice(policyStart, policyEnd).trim() : '';
check(
  'ACX2 the description carries one contiguous shared policy block before the grammar section',
  sharedPolicyBlock.length > 0,
  'policyStart=' + policyStart + ' policyEnd=' + policyEnd,
);

const collapsedSectionText = collapse(textOf(section));
const sharedPolicySentences = sharedPolicyBlock
  .split('. ')
  .map((sentence) => (sentence.endsWith('.') ? sentence : sentence + '.'))
  .filter((sentence) => sentence.length > 1);
const missingSentences = sharedPolicySentences.filter((sentence) => !collapsedSectionText.includes(sentence));
// The derivation must be non-vacuous: the slice has to carry every policy anchor
// the SPEC fixes on the description, and every one of its sentences must appear in B.
const requiredPolicyAnchors = ['When to use', 'Default:', 'Exempt only when', 'Decision moments', 'Budget:'];
check(
  'ACX2 every shared policy sentence of the description appears verbatim in the section (A/B single source)',
  requiredPolicyAnchors.every((anchor) => sharedPolicyBlock.includes(anchor)) &&
    sharedPolicySentences.length > 0 &&
    missingSentences.length === 0,
  'shared=' + sharedPolicySentences.length + ' missing=' + JSON.stringify(missingSentences.map((sentence) => sentence.slice(0, 60))),
);
for (const prefix of ['Default:', 'Budget:']) {
  const sharedSentence = sharedPolicySentences.find((sentence) => sentence.startsWith(prefix)) ?? '';
  check(
    'ACX2 the complete shared "' + prefix + '" sentence appears in the section, not just the anchor',
    sharedSentence.length > prefix.length && collapsedSectionText.includes(sharedSentence),
    'sentence=' + JSON.stringify(sharedSentence.slice(0, 120)),
  );
}

// --- summary ------------------------------------------------------------------
console.log('');
console.log(failures === 0 ? 'POLICY OK' : 'POLICY FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
