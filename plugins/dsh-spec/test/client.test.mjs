/**
 * Client bundle tests (stub React, no browser, no network).
 *
 * Loads lib/client.js the same way the Web module loader does, then renders the
 * composer entry and the Specs pane against a fake RPC channel. Assertions pin
 * the interaction contract:
 *
 *   - a dockable right-sidebar tab (type declared, body and chip keyed by the
 *     type's id) plus a Spec-only composer,
 *   - the composer only exists inside the Spec preset, and its choice reaches
 *     the host before the user opens the 规格 tab,
 *   - the pane lists only documents that exist on disk,
 *   - selecting a document is the only navigation layer.
 *
 * Run: node --test test/client.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// ---------------------------------------------------------------------------
// Stub React with dependency-aware effects and a synchronous re-render loop
// ---------------------------------------------------------------------------
const hooks = [];
let hookIndex = 0;
let dirty = false;

const react = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat().filter((child) => child !== null && child !== undefined && child !== false) };
  },
  useState(initial) {
    const index = hookIndex++;
    if (!(index in hooks)) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
    const slot = hooks[index];
    if (!slot.set) {
      slot.set = (next) => {
        const value = typeof next === "function" ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        dirty = true;
      };
    }
    return [slot.value, slot.set];
  },
  useEffect(effect, deps) {
    const index = hookIndex++;
    const slot = hooks[index] ?? (hooks[index] = {});
    const changed = slot.deps === undefined
      || deps === undefined
      || deps.length !== slot.deps.length
      || deps.some((dep, position) => !Object.is(dep, slot.deps[position]));
    if (!changed) return;
    if (typeof slot.cleanup === "function") slot.cleanup();
    slot.deps = deps;
    slot.cleanup = effect();
    dirty = true;
  },
  useCallback(fn) {
    hookIndex += 1;
    return fn;
  },
};

// ---------------------------------------------------------------------------
// Load the bundle
// ---------------------------------------------------------------------------
let registration = null;
// The panel follows the host locale; without the locale plugin mounted it reads
// the browser tag. Pin it so label assertions do not depend on the machine.
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "zh-CN" } });
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registration = entry;
    },
  },
  addEventListener() {},
  removeEventListener() {},
};

// Simulate a tag left behind by a navigation-only release before an upgrade.
const styles = [{ id: "dsh-spec-nav-styles", textContent: ".ks-nav-label{display:inline-flex}", setAttribute(name, value) { this[name] = value; } }];
const appendStyle = (style) => styles.push(style);
globalThis.document = {
  getElementById: (id) => styles.find((style) => style.id === id) || null,
  createElement: () => ({ id: "", textContent: "", setAttribute(name, value) { this[name] = value; } }),
  head: { appendChild: appendStyle },
  body: { appendChild: appendStyle },
};

const clientPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js');
// eslint-disable-next-line no-eval
(0, eval)(readFileSync(clientPath, "utf8"));

const mod = registration.factory((id) => {
  if (id === "react") return react;
  throw new Error(`unexpected require: ${id}`);
});

const SPECS = [
  {
    feature: "login-revamp",
    specType: "feature",
    workflowType: "requirements-first",
    phase: "design",
    directory: "/tmp/ws/.kiro/specs/login-revamp",
    documents: { requirements: true, bugfix: false, design: true, tasks: false },
    requirements: 2,
    clauses: 4,
    properties: 1,
    progress: null,
    ready: [],
    issues: { error: 0, warning: 0, info: 0 },
    ok: true,
  },
  {
    feature: "checkout-flow",
    specType: "feature",
    workflowType: "requirements-first",
    phase: "execution",
    directory: "/tmp/ws/.kiro/specs/checkout-flow",
    documents: { requirements: true, bugfix: false, design: true, tasks: true },
    requirements: 3,
    clauses: 6,
    properties: 2,
    progress: { total: 4, leaves: 3, required: 2, optional: 1, completed: 1, inProgress: 0, queued: 0, notStarted: 1, percent: 50 },
    ready: [{ id: "2.1", title: "Unit test" }],
    issues: { error: 0, warning: 1, info: 0 },
    ok: true,
  },
];

const DETAIL = {
  feature: "login-revamp",
  directory: "/tmp/ws/.kiro/specs/login-revamp",
  config: { specId: "x", workflowType: "requirements-first", specType: "feature", reported: true },
  phase: "design",
  documents: [
    { name: "requirements.md", exists: true, bytes: 120 },
    { name: "design.md", exists: true, bytes: 90 },
    { name: "tasks.md", exists: false, bytes: 0 },
    { name: "bugfix.md", exists: false, bytes: 0 },
  ],
  requirements: [
    { id: "1", title: "Fast login", userStory: "As a user, I want speed.", criteria: [{ id: "1.1", text: "WHEN signing in, THE System SHALL respond within 2s" }] },
  ],
  properties: [{ number: 1, title: "Round trip", kind: "property", validates: ["1.1"] }],
  tasks: [],
  dependencyGraph: null,
  progress: null,
  ready: [],
  issues: [],
  counts: { error: 0, warning: 0, info: 0 },
  ok: true,
  metadata: { pbtResults: {}, executionHistory: {} },
};

const TASKS_DETAIL = {
  ...DETAIL,
  feature: "checkout-flow",
  directory: "/tmp/ws/.kiro/specs/checkout-flow",
  phase: "execution",
  documents: [
    { name: "requirements.md", exists: true, bytes: 120 },
    { name: "design.md", exists: true, bytes: 90 },
    { name: "tasks.md", exists: true, bytes: 60 },
    { name: "bugfix.md", exists: false, bytes: 0 },
  ],
  tasks: [
    { id: "1", title: "Add endpoint", status: "completed", optional: false, depth: 0, wave: 0, parent: null, requirements: ["1.1"], line: 6, children: [] },
    { id: "2", title: "Tests", status: "in_progress", optional: false, depth: 0, wave: null, parent: null, requirements: [], line: 9, children: ["2.1"] },
    { id: "2.1", title: "Unit test", status: "not_started", optional: false, depth: 1, wave: 1, parent: "2", requirements: ["2.1"], line: 10, children: [] },
    { id: "2.2", title: "Property test", status: "not_started", optional: true, depth: 1, wave: 1, parent: "2", requirements: ["1.1"], line: 13, children: [] },
  ],
  dependencyGraph: { waves: [{ id: 0, tasks: ["1"] }, { id: 1, tasks: ["2.1", "2.2"] }] },
  progress: { total: 4, leaves: 3, required: 2, optional: 1, completed: 1, inProgress: 1, queued: 0, notStarted: 1, percent: 50 },
  ready: [{ id: "2.1", title: "Unit test", optional: false, wave: 1 }],
  issues: [{ severity: "warning", message: "Task 2.2 is optional", rule: "spec/test", file: "tasks.md", line: 13 }],
  counts: { error: 0, warning: 1, info: 0 },
};

const SETTINGS = {
  workspace: "/tmp/ws",
  root: "/tmp/ws/.kiro/specs",
  presetActive: true,
  settings: {
    values: {
      kiroDir: ".kiro", promptEnabled: true, includeActiveSpecs: true,
      promptMaxSpecs: 5, strict: false, defaultSpecType: "feature", defaultWorkflow: "requirements-first",
    },
    defaults: {},
    file: "/tmp/home/spec/settings.json",
    stored: false,
    warnings: [],
  },
  specs: SPECS,
  activeSpec: null,
  binding: null,
  draft: null,
};

function describeWith(overrides = {}) {
  return { ...SETTINGS, ...overrides };
}

function createRpc(handler) {
  const calls = [];
  const rpc = async (method, payload) => {
    calls.push({ method, payload });
    return handler(method, payload);
  };
  rpc.calls = calls;
  return rpc;
}

// ---------------------------------------------------------------------------
// Mini renderer
// ---------------------------------------------------------------------------
function isElement(value) {
  return value !== null && typeof value === "object" && "type" in value;
}

function render(node) {
  if (node === null || node === undefined || node === false) return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(render).filter((child) => child !== null);
  if (!isElement(node)) return String(node);
  if (typeof node.type === "function") {
    return render(node.type({ ...node.props, children: node.children }));
  }
  return {
    type: node.type,
    props: node.props,
    children: node.children.map(render).filter((child) => child !== null).flat(),
  };
}

function textOf(tree) {
  if (tree === null || tree === undefined) return "";
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(textOf).join(" ");
  return `${textOf(tree.children)}`;
}

function collect(tree, predicate, found = []) {
  if (tree === null || tree === undefined) return found;
  if (typeof tree === "string") return found;
  if (Array.isArray(tree)) {
    for (const child of tree) collect(child, predicate, found);
    return found;
  }
  if (predicate(tree)) found.push(tree);
  collect(tree.children, predicate, found);
  return found;
}

function byType(tree, type) {
  return collect(tree, (node) => node.type === type);
}

function buttonByText(tree, label) {
  return collect(tree, (node) => node.type === "button" && textOf(node.children).replace(/\s+/gu, " ").trim() === label)[0];
}

async function settle(component, props, max = 60) {
  let tree = null;
  for (let round = 0; round < max; round += 1) {
    dirty = false;
    hookIndex = 0;
    tree = render(react.createElement(component, props));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!dirty) break;
  }
  return tree;
}

function resetHooks() {
  for (const slot of hooks) {
    if (typeof slot?.cleanup === "function") slot.cleanup();
  }
  hooks.length = 0;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function makeContext(overrides = {}) {
  const registered = [];
  const opened = [];
  const callbacks = [];
  const pendingInjects = [];
  // The host's own Session sources: the plugin registers its conversation view
  // only while the main session's preset is `spec`, so the harness models both.
  const listeners = new Set();
  const state = {
    current: "s1",
    sessions: { s1: { projectionValues: { agentPreset: "spec" } } },
  };
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const sessions = {
    getSnapshot: () => ({ byId: state.sessions }),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const current = {
    getSnapshot: () => ({ key: state.current }),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const ctx = {
    on: (event, callback) => { if (event === "dispose") callbacks.push(callback); },
    effect: (factory) => {
      const dispose = factory();
      callbacks.push(dispose);
      return dispose;
    },
    connection: { rpc: { call: async () => ({ ok: true, value: describeWith() }) } },
    get: (name) => {
      if (name === "sessions") return { list: sessions };
      if (name === "uiSession") return { adapter: { current } };
      if (name === "uiConversation") {
        return {
          binding: (sessionId) => ({
            activate: (viewId) => { opened.push({ sessionId, viewId }); },
          }),
        };
      }
      return undefined;
    },
    // Cordis runs the callback in a child fiber once every named service is
    // there; a service that never appears leaves the callback pending.
    inject: (deps, callback) => {
      if (deps.every((name) => ctx.get(name) !== undefined)) callback(ctx);
      else pendingInjects.push(callback);
    },
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => {
        const entry = { options, component };
        registered.push(entry);
        return () => {
          const index = registered.indexOf(entry);
          if (index !== -1) registered.splice(index, 1);
        };
      },
    },
    ...overrides,
  };
  mod.apply(ctx);
  return {
    registered,
    opened,
    ctx,
    /** Switch the main session to another preset, the way the host would. */
    setPreset: (preset, sessionId = state.current) => {
      state.sessions[sessionId] = { projectionValues: { agentPreset: preset } };
      notify();
    },
    /** Show another session as the main one. */
    showSession: (sessionId) => {
      state.current = sessionId;
      notify();
    },
    dispose: () => callbacks.forEach((callback) => callback()),
  };
}

function registeredNames(host) {
  return host.registered.map((entry) => entry.options.name).sort();
}

function entryOf(host, name) {
  return host.registered.find((entry) => entry.options.name === name);
}

test("the bundle registers with the loader and exports apply/inject", () => {
  assert.equal(registration.id, "@weniatall/dsh-spec");
  assert.equal(typeof mod.apply, "function");
  assert.deepEqual(mod.inject, ["slots", "connection", "locale"]);
});

test("the pane is a conversation view tab beside 对话 and 轨迹", () => {
  const host = makeContext();
  assert.deepEqual(registeredNames(host), ["conversation.input.dock", "conversation.input.left", "conversation.view"]);
  const view = entryOf(host, "conversation.view");
  assert.equal(view.options.id, "spec");
  // The label is a thunk: the host re-resolves it on every locale revision.
  assert.equal(view.options.label(), "规格");
  // Host chat uses order 0 and the trajectory view 10: 20 puts 规格 to the right.
  assert.equal(view.options.order, 20);
  assert.ok(view.options.order > 10, "the 规格 tab must sit right of 轨迹");
  const injected = view.options.inject("s1");
  assert.equal(injected.sessionId, "s1");
  assert.equal(injected.rpcCall("describe", {}).then !== undefined, true);
  // The right sidebar and the old full-screen overlay are gone.
  for (const name of ["shell.overlay", "settings.section", "sidebar.right.pane.tab", "sidebar.right.pane.tab.title"]) {
    assert.equal(entryOf(host, name), undefined, `${name} must not be registered`);
  }
});

test("the view entry exists only while the main session runs the Spec preset", () => {
  // The host's view roster is global: an always-on entry would put an empty 规格
  // tab in every standard-mode session.
  const host = makeContext();
  assert.equal(entryOf(host, "conversation.view").options.id, "spec");
  host.setPreset("standard");
  assert.equal(entryOf(host, "conversation.view"), undefined, "standard mode drops the tab");
  host.setPreset("spec");
  assert.equal(entryOf(host, "conversation.view").options.id, "spec", "the tab returns");
});

test("a standard-mode session never gains the tab from another session's preset", () => {
  const host = makeContext();
  host.showSession("s2");
  assert.equal(entryOf(host, "conversation.view"), undefined, "an unknown session has no preset");
  host.setPreset("spec", "s2");
  assert.equal(entryOf(host, "conversation.view").options.id, "spec");
  host.showSession("s1");
  assert.equal(entryOf(host, "conversation.view").options.id, "spec", "s1 is still a Spec session");
});

test("the view entry is scoped to the plugin's effect", () => {
  const host = makeContext();
  assert.equal(entryOf(host, "conversation.view").options.id, "spec");
  host.dispose();
  assert.equal(entryOf(host, "conversation.view"), undefined, "disposing the plugin retires its tab");
});

test("a host without Session sources registers no view and never throws", () => {
  const host = makeContext({ get: () => undefined });
  assert.deepEqual(registeredNames(host), ["conversation.input.dock", "conversation.input.left"]);
  const composer = entryOf(host, "conversation.input.left").options.inject("s1");
  assert.equal(composer.canOpenSpecView(), false);
  assert.equal(composer.openSpecView("s1"), false, "a missing service must not throw");
});

test("the chip switches the session's conversation to the 规格 view", () => {
  const host = makeContext();
  const composer = entryOf(host, "conversation.input.left").options.inject("s1");
  assert.equal(composer.canOpenSpecView(), true);
  assert.equal(composer.openSpecView("s1"), true);
  assert.deepEqual(host.opened, [{ sessionId: "s1", viewId: "spec" }]);
});

test("a host whose conversation binding refuses the switch reports failure", () => {
  const host = makeContext({
    get: (name) => (name === "uiConversation"
      ? { binding: () => ({ activate: () => { throw new Error("ui-conversation: unknown session"); } }) }
      : undefined),
  });
  const composer = entryOf(host, "conversation.input.left").options.inject("s1");
  assert.equal(composer.openSpecView("s1"), false);
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
test("the factory refreshes navigation-only CSS and marks plugin ownership", () => {
  assert.equal(styles.length, 1, "reuse the existing tag rather than duplicating styles");
  assert.equal(styles[0]["data-plugin"], "@weniatall/dsh-spec");
  for (const selector of [".ks-pane{", ".ks-tree{", ".ks-type-pill{", ".ks-menu{", ".ks-md{", ".ks-md-table{"]) {
    assert.ok(styles[0].textContent.includes(selector), `missing ${selector}`);
  }
  assert.match(styles[0].textContent, /var\(--ds-font-family-code,/u);
  assert.match(styles[0].textContent, /var\(--dsw-alias-state-warn-primary,/u);
  assert.doesNotMatch(styles[0].textContent, /font:var\(--dsw-font-(?:m-16|l-20)\)/u);
});

test("apply refreshes stale CSS and recreates a removed stylesheet idempotently", () => {
  const ctx = { slots: { inject() {} }, get: () => undefined };
  styles[0].textContent = ".ks-nav-label{display:inline-flex}";
  mod.apply(ctx);
  assert.match(styles[0].textContent, /\.ks-type-pill\{/u);
  styles.length = 0;
  mod.apply(ctx);
  mod.apply(ctx);
  assert.equal(styles.length, 1);
  assert.match(styles[0].textContent, /\.ks-pane\{/u);
});

// ---------------------------------------------------------------------------
// Composer entry
// ---------------------------------------------------------------------------
function collectComposer() {
  return makeContext().registered.find((entry) => entry.options.name === "conversation.input.left").component;
}

function specModeProps(sessionId, rpc, extra = {}) {
  return {
    rpcCall: rpc,
    sessionId,
    useSessions: (selector) => selector({ byId: { [sessionId]: { projectionValues: { agentPreset: "spec" } } } }),
    canOpenSpecView: () => true,
    ...extra,
  };
}

test("the composer is absent outside Spec mode", async () => {
  resetHooks();
  const rpc = createRpc(() => describeWith());
  const props = {
    rpcCall: rpc,
    sessionId: "standard",
    useSessions: (selector) => selector({ byId: { standard: { projectionValues: { agentPreset: "standard" } } } }),
  };
  assert.equal(await settle(collectComposer(), props), null);
  assert.equal(rpc.calls.length, 0, "a non-Spec conversation needs no RPC");
});

test("legacy hosts gate the composer on describe.presetActive", async () => {
  for (const presetActive of [false, undefined]) {
    resetHooks();
    const rpc = createRpc(() => describeWith({ presetActive }));
    assert.equal(await settle(collectComposer(), { rpcCall: rpc, sessionId: "s1" }), null);
  }
  resetHooks();
  const rpc = createRpc(() => describeWith({ presetActive: true }));
  const tree = await settle(collectComposer(), { rpcCall: rpc, sessionId: "s1" });
  assert.match(textOf(tree), /Spec/u);
});

test("the unbound composer offers creation types and existing specs", async () => {
  resetHooks();
  const rpc = createRpc(() => describeWith());
  const composer = collectComposer();
  let tree = await settle(composer, specModeProps("s1", rpc));
  const pill = collect(tree, (node) => node.props["data-tone"] === "open")[0];
  assert.ok(pill, "an unbound Spec session shows the entry");
  pill.props.onClick();
  tree = await settle(composer, specModeProps("s1", rpc));
  const labels = collect(tree, (node) => node.props.role === "menuitem").map((node) => textOf(node.children));
  for (const expected of ["Feature", "Bugfix", "Quick spec"]) assert.ok(labels.includes(expected), `missing ${expected}`);
  assert.ok(labels.some((label) => label.includes("login-revamp")), "existing specs are offered for association");
  assert.ok(labels.some((label) => label.includes("checkout-flow")));
});

test("choosing a type persists the draft and points at the 规格 sidebar", async () => {
  resetHooks();
  const rpc = createRpc(() => describeWith());
  const composer = collectComposer();
  let tree = await settle(composer, specModeProps("s1", rpc));
  collect(tree, (node) => node.props["data-tone"] === "open")[0].props.onClick();
  tree = await settle(composer, specModeProps("s1", rpc));
  const bugfix = collect(tree, (node) => node.props.role === "menuitem" && textOf(node.children) === "Bugfix")[0];
  assert.ok(bugfix);
  bugfix.props.onClick();
  tree = await settle(composer, specModeProps("s1", rpc));
  const draft = rpc.calls.find((call) => call.method === "saveDraft");
  assert.ok(draft, "the choice must reach the host");
  assert.deepEqual(draft.payload, { sessionId: "s1", specType: "bugfix" });
  assert.match(textOf(tree), /在「规格」页签新建/u);
});

test("associating an existing spec binds it to the session", async () => {
  resetHooks();
  const rpc = createRpc((method) => (method === "bind"
    ? { binding: { feature: "checkout-flow" }, activeSpec: { feature: "checkout-flow", specType: "feature", phase: "execution" }, draft: null }
    : describeWith()));
  const composer = collectComposer();
  let tree = await settle(composer, specModeProps("s1", rpc));
  collect(tree, (node) => node.props["data-tone"] === "open")[0].props.onClick();
  tree = await settle(composer, specModeProps("s1", rpc));
  const option = collect(tree, (node) => node.props.role === "menuitem" && textOf(node.children).includes("checkout-flow"))[0];
  assert.ok(option);
  option.props.onClick();
  const associated = await settle(composer, specModeProps("s1", rpc));
  assert.match(textOf(associated), /「规格」页签查看/u);
  const call = rpc.calls.find((entry) => entry.method === "bind");
  assert.deepEqual(call.payload, { sessionId: "s1", feature: "checkout-flow" });
});

test("a bound session's chip opens the Specs tab and writes nothing", async () => {
  resetHooks();
  const opened = [];
  const rpc = createRpc(() => describeWith({
    activeSpec: { feature: "login-revamp", specType: "feature", phase: "design" },
    binding: { feature: "login-revamp" },
  }));
  const composer = collectComposer();
  const props = specModeProps("s1", rpc, { openSpecView: (sessionId) => { opened.push(sessionId); return true; } });
  const tree = await settle(composer, props);
  const chip = collect(tree, (node) => node.props["data-tone"] === "locked")[0];
  assert.ok(chip);
  assert.match(textOf(chip.children), /login-revamp/u);
  assert.match(textOf(chip.children), /设计阶段/u);
  // The chip is the way into the panel now, so it is a real button.
  assert.equal(chip.type, "button");
  assert.equal(chip.props.disabled, false);
  assert.match(chip.props.title, /打开「规格」页签/u);
  chip.props.onClick();
  assert.deepEqual(opened, ["s1"]);
  assert.equal(rpc.calls.some((call) => call.method === "saveDraft" || call.method === "bind"), false);
});

test("without a right sidebar the entry says so instead of opening nothing", async () => {
  resetHooks();
  const rpc = createRpc(() => describeWith({
    activeSpec: { feature: "login-revamp", specType: "feature", phase: "design" },
    binding: { feature: "login-revamp" },
  }));
  const composer = collectComposer();
  const props = specModeProps("s1", rpc, { canOpenSpecView: () => false, openSpecView: () => false });
  const tree = await settle(composer, props);
  const chip = collect(tree, (node) => node.props["data-tone"] === "locked")[0];
  assert.equal(chip.props.disabled, true);
  assert.match(chip.props.title, /宿主未提供会话视图/u);
});

test("the menu opens the tab and a type choice still only persists the draft", async () => {
  resetHooks();
  const opened = [];
  const rpc = createRpc(() => describeWith());
  const composer = collectComposer();
  const props = specModeProps("s1", rpc, { openSpecView: (sessionId) => { opened.push(sessionId); return true; } });
  let tree = await settle(composer, props);
  collect(tree, (node) => node.props["data-tone"] === "open")[0].props.onClick();
  tree = await settle(composer, props);
  const openItem = collect(tree, (node) => node.props.role === "menuitem" && textOf(node.children).includes("打开「规格」页签"))[0];
  assert.ok(openItem, "the menu carries the way into the panel");
  openItem.props.onClick();
  assert.deepEqual(opened, ["s1"]);
  assert.equal(rpc.calls.some((call) => call.method === "saveDraft"), false, "opening is not a draft write");

  resetHooks();
  tree = await settle(composer, props);
  collect(tree, (node) => node.props["data-tone"] === "open")[0].props.onClick();
  tree = await settle(composer, props);
  const bugfix = collect(tree, (node) => node.props.role === "menuitem" && textOf(node.children) === "Bugfix")[0];
  bugfix.props.onClick();
  await settle(composer, props);
  assert.deepEqual(opened, ["s1"], "choosing a type does not open the tab by itself");
  assert.ok(rpc.calls.some((call) => call.method === "saveDraft"));
});

test("a confirmed Spec session surfaces RPC failures instead of hiding them", async () => {
  resetHooks();
  const rpc = createRpc(() => { throw new Error("connection lost"); });
  const tree = await settle(collectComposer(), specModeProps("s1", rpc));
  const error = collect(tree, (node) => node.props["data-tone"] === "err")[0];
  assert.ok(error);
  assert.equal(error.props.title, "connection lost");
});

// ---------------------------------------------------------------------------
// Specs pane
// ---------------------------------------------------------------------------
function collectTab(sessions = { byId: { s1: { projectionValues: { agentPreset: "spec" } } } }) {
  const Body = entryOf(makeContext(), "conversation.view").component;
  // The entry is the Spec-preset gate around the pane, so feed it a Spec
  // session's projection the way the host's Session store would.
  return (props) => Body({ ...props, useSessions: (select) => select(sessions) });
}

function paneRpc(extra = {}) {
  return createRpc((method, payload) => {
    if (method === "describe") return extra.describe ? extra.describe(payload) : describeWith();
    if (method === "get") {
      const base = payload.feature === "checkout-flow" ? TASKS_DETAIL : DETAIL;
      return extra.get ? extra.get(payload, base) : base;
    }
    if (method === "document") {
      return extra.document
        ? extra.document(payload)
        : { feature: payload.feature, document: `${payload.document}.md`, content: `# ${payload.document} of ${payload.feature}`, phase: "design" };
    }
    if (method === "taskUpdate") return { feature: payload.feature, taskId: payload.taskId, status: payload.status, propagated: [], warnings: [], ready: [] };
    if (method === "create") return { feature: "new-spec", directory: "/tmp/ws/.kiro/specs/new-spec", files: ["requirements.md"], specType: payload.specType, workflowType: payload.workflowType, phase: "requirements", binding: { feature: "new-spec" } };
    if (method === "check") return { root: SETTINGS.root, strict: false, ok: true, specs: [{ feature: payload.feature, phase: "design", ok: true, counts: { error: 0, warning: 0, info: 0 }, issues: [] }], totals: { error: 0, warning: 0, info: 0 } };
    if (method === "bind") return { binding: { feature: payload.feature }, activeSpec: { feature: payload.feature, specType: "feature", phase: "design" }, draft: null };
    if (method === "unbind") return { binding: null, activeSpec: null, draft: null };
    if (method === "saveSettings") return { settings: describeWith().settings, workspace: SETTINGS.workspace, root: SETTINGS.root };
    if (method === "resetSettings") return { settings: describeWith().settings, workspace: SETTINGS.workspace, root: SETTINGS.root };
    return {};
  });
}

test("the tree lists only documents that exist, even when the phase is further ahead", async () => {
  resetHooks();
  const tab = collectTab();
  const rpc = paneRpc();
  // login-revamp is in the design phase and has no tasks.md. A phase-derived
  // tree used to invent Design (and Tasks) nodes; presence decides now.
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const feature = collect(tree, (node) => node.type === "button" && node.props.role === "treeitem" && node.props["data-state"] === undefined && textOf(node.children).includes("login-revamp"))[0];
  feature.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const leaves = collect(tree, (node) => node.type === "button" && node.props.role === "treeitem" && node.props["data-state"] !== undefined);
  assert.deepEqual(leaves.map((node) => textOf(node.children).replace(/\s+/gu, " ").trim()), ["Requirements", "Design"]);
  assert.ok(!leaves.some((node) => textOf(node.children).includes("Tasks")), "an unwritten tasks.md has no node");
});

test("the binding selects the spec, and the document is the only navigation layer", async () => {
  resetHooks();
  const tab = collectTab();
  const rpc = paneRpc({ describe: () => describeWith({ activeSpec: { feature: "checkout-flow", specType: "feature", phase: "execution" }, binding: { feature: "checkout-flow" } }) });
  const tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const text = textOf(tree);
  // The bound spec is selected and its documents are shown.
  assert.match(text, /checkout-flow/u);
  assert.match(text, /任务进度/u);
  assert.match(text, /tasks\.md/u);
  // There is exactly one document body; no five-way tab bar over the content.
  assert.equal(collect(tree, (node) => node.props.role === "tab").length, 0);
  const get = rpc.calls.filter((call) => call.method === "get");
  assert.equal(get[0].payload.feature, "checkout-flow");
});

test("clicking a document node loads that document", async () => {
  resetHooks();
  const tab = collectTab();
  const rpc = paneRpc();
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const feature = collect(tree, (node) => node.type === "button" && node.props.role === "treeitem" && node.props["data-state"] === undefined && textOf(node.children).includes("login-revamp"))[0];
  feature.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const design = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Design"))[0];
  design.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const call = rpc.calls.find((entry) => entry.method === "document");
  assert.deepEqual(call.payload, { sessionId: "s1", feature: "login-revamp", document: "design" });
  // The document is rendered, not dumped: the `#` marker becomes a heading and
  // the original Markdown never reaches the page as text.
  const heading = collect(tree, (node) => node.props["data-level"] === "1")[0];
  assert.ok(heading, "the document's first heading is rendered as a heading");
  assert.equal(textOf(heading.children), "design of login-revamp");
  assert.doesNotMatch(textOf(tree), /# design of login-revamp/u);
  assert.equal(collect(tree, (node) => node.props.role === "tab").length, 0);
});

test("refresh reloads the document that is currently open", async () => {
  resetHooks();
  const tab = collectTab();
  let revision = 1;
  const rpc = paneRpc({ document: (payload) => ({ feature: payload.feature, document: `${payload.document}.md`, content: `revision ${revision}`, phase: "design" }) });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const feature = collect(tree, (node) => node.type === "button" && node.props.role === "treeitem" && node.props["data-state"] === undefined && textOf(node.children).includes("login-revamp"))[0];
  feature.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const design = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Design"))[0];
  design.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(tree), /revision 1/u);
  revision = 2;
  buttonByText(tree, "刷新").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(tree), /revision 2/u);
});

test("an empty workspace offers the create flow with the host's draft defaults", async () => {
  resetHooks();
  const tab = collectTab();
  const rpc = paneRpc({ describe: () => describeWith({ specs: [], activeSpec: null, draft: { specType: "bugfix", workflowType: "fast-task" } }) });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(tree), /还没有 Spec/u);
  buttonByText(tree, "新建 Spec").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const selects = byType(tree, "select");
  assert.equal(selects[0].props.value, "bugfix", "the draft type seeds the form");
  assert.equal(selects[1].props.value, "fast-task", "the draft workflow seeds the form");
  byType(tree, "input")[0].props.onChange({ target: { value: "New Spec" } });
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  buttonByText(tree, "创建").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const create = rpc.calls.find((call) => call.method === "create");
  assert.deepEqual(create.payload, { sessionId: "s1", title: "New Spec", specType: "bugfix", workflowType: "fast-task" });
  assert.match(textOf(tree), /new-spec/u);
});

test("task status is written through taskUpdate from the tasks document", async () => {
  resetHooks();
  const tab = collectTab();
  const rpc = paneRpc({ describe: () => describeWith({ activeSpec: { feature: "checkout-flow", specType: "feature", phase: "execution" }, binding: { feature: "checkout-flow" } }) });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const tasks = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Tasks"))[0];
  tasks.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const boxes = byType(tree, "input").filter((node) => node.props.type === "checkbox");
  assert.equal(boxes.length, 4);
  boxes[2].props.onChange();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const update = rpc.calls.find((call) => call.method === "taskUpdate");
  assert.equal(update.payload.sessionId, "s1");
  assert.equal(update.payload.taskId, "2.1");
  assert.match(textOf(tree), /任务 2\.1/u);
});

test("a parent completed by its subtasks shows as done and cannot be toggled", async () => {
  // The host derives `derived: true` for a parent whose required children are
  // all completed even when its own checkbox was never checked. The row must
  // show that honestly, and must not offer a control that silently reverts.
  resetHooks();
  const tab = collectTab();
  const detail = {
    ...TASKS_DETAIL,
    tasks: [
      { id: "1", title: "Add endpoint", status: "completed", optional: false, depth: 0, wave: 0, parent: null, requirements: [], line: 6, children: [] },
      { id: "2", title: "Tests", status: "completed", derived: true, optional: false, depth: 0, wave: null, parent: null, requirements: [], line: 9, children: ["2.1"] },
      { id: "2.1", title: "Unit test", status: "completed", optional: false, depth: 1, wave: 1, parent: "2", requirements: [], line: 10, children: [] },
    ],
  };
  const rpc = paneRpc({
    describe: () => describeWith({ activeSpec: { feature: "checkout-flow", specType: "feature", phase: "execution" }, binding: { feature: "checkout-flow" } }),
    get: () => detail,
  });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const tasks = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Tasks"))[0];
  tasks.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const boxes = byType(tree, "input").filter((node) => node.props.type === "checkbox");
  const parent = boxes.find((node) => node.props["aria-label"].startsWith("任务 2 "));
  assert.equal(parent.props.checked, true, "a parent finished by its subtasks reads as done");
  assert.equal(parent.props.disabled, true, "its own control cannot change anything");
  assert.match(textOf(tree), /随子任务/u);
  const child = boxes.find((node) => node.props["aria-label"].startsWith("任务 2.1 "));
  assert.equal(child.props.disabled, false, "leaf tasks stay editable");
  assert.equal(rpc.calls.some((call) => call.method === "taskUpdate"), false, "rendering writes nothing");
});

test("a task row shows its heading first and the explanation under it", async () => {
  // Agents write paragraph-long task titles ("1.1 Create the manifest:
  // `package.json` with …, `bin` …, `scripts` …"). Rendered as one string the
  // id, the title and the detail all blur together; the row splits them.
  resetHooks();
  const tab = collectTab();
  const LONG = "Create the package manifest and repository layout: `package.json` with \"type\": \"module\", \"bin\": { \"wc-lite\": \"bin/wc-lite.js\" }, and no dependencies at all";
  const detail = {
    ...TASKS_DETAIL,
    tasks: [
      { id: "1.1", title: LONG, status: "not_started", optional: false, depth: 1, wave: 0, parent: "1", requirements: [], line: 6, children: [] },
    ],
    dependencyGraph: { waves: [{ id: 0, tasks: ["1.1"] }] },
  };
  const rpc = paneRpc({
    describe: () => describeWith({ activeSpec: { feature: "checkout-flow", specType: "feature", phase: "execution" }, binding: { feature: "checkout-flow" } }),
    get: () => detail,
  });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const tasks = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Tasks"))[0];
  tasks.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });

  const heading = collect(tree, (node) => String(node.props?.className || "") === "ks-task-title")[0];
  assert.ok(heading, "the row has a heading line");
  assert.equal(textOf(heading).trim(), "1.1 Create the package manifest and repository layout");
  assert.equal(heading.props.title, LONG, "the full title stays reachable on hover");
  const id = collect(heading, (node) => String(node.props?.className || "") === "ks-task-id")[0];
  assert.equal(textOf(id), "1.1", "the id is its own span, not glued to the title");

  const body = collect(tree, (node) => String(node.props?.className || "") === "ks-task-detail")[0];
  assert.ok(body, "the explanation is its own line");
  assert.match(textOf(body), /package\.json/u);
  assert.doesNotMatch(textOf(body), /^1\.1/u, "the detail does not repeat the id");

  // The graph chip shows the same heading, not the paragraph.
  const chip = collect(tree, (node) => String(node.props?.className || "") === "ks-wave-name")[0];
  assert.equal(textOf(chip), "Create the package manifest and repository layout");
});

test("a title with no natural break stays whole", async () => {
  resetHooks();
  const tab = collectTab();
  const detail = {
    ...TASKS_DETAIL,
    tasks: [
      { id: "2.1", title: "Unit test", status: "not_started", optional: false, depth: 1, wave: 0, parent: "2", requirements: [], line: 6, children: [] },
    ],
    dependencyGraph: { waves: [{ id: 0, tasks: ["2.1"] }] },
  };
  const rpc = paneRpc({
    describe: () => describeWith({ activeSpec: { feature: "checkout-flow", specType: "feature", phase: "execution" }, binding: { feature: "checkout-flow" } }),
    get: () => detail,
  });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const tasks = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Tasks"))[0];
  tasks.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const heading = collect(tree, (node) => String(node.props?.className || "") === "ks-task-title")[0];
  assert.equal(textOf(heading).trim(), "2.1 Unit test");
  assert.equal(collect(tree, (node) => String(node.props?.className || "") === "ks-task-detail").length, 0);
});

test("the dependency graph renders as waves of parallel work, not a list of ids", async () => {
  resetHooks();
  const tab = collectTab();
  // The user's complaint: `#1 [2.1, 3.1, 4.1, 6.1]` is unreadable. A wave must
  // read as "these run together", with each task's own title and status.
  const detail = {
    ...TASKS_DETAIL,
    tasks: [
      { id: "2.1", title: "count.js", status: "completed", optional: false, depth: 1, wave: 1, parent: "2", requirements: [], line: 6, children: [] },
      { id: "3.1", title: "report.js", status: "in_progress", optional: false, depth: 1, wave: 1, parent: "3", requirements: [], line: 7, children: [] },
      { id: "4.1", title: "cli.js", status: "not_started", optional: false, depth: 1, wave: 1, parent: "4", requirements: [], line: 8, children: [] },
      { id: "5.1", title: "end-to-end", status: "not_started", optional: true, depth: 1, wave: 2, parent: "5", requirements: [], line: 9, children: [] },
      { id: "9.1", title: "orphan", status: "not_started", optional: false, depth: 1, wave: null, parent: "9", requirements: [], line: 10, children: [] },
    ],
    dependencyGraph: { waves: [{ id: 0, tasks: ["2.1", "3.1", "4.1"] }, { id: 1, tasks: ["5.1"] }] },
  };
  const rpc = paneRpc({
    describe: () => describeWith({ activeSpec: { feature: "checkout-flow", specType: "feature", phase: "execution" }, binding: { feature: "checkout-flow" } }),
    get: () => detail,
  });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const tasks = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Tasks"))[0];
  tasks.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });

  const graph = collect(tree, (node) => typeof node.type === "string" && node.props && node.props["aria-label"] === "任务依赖图")[0];
  assert.ok(graph, "the graph is its own labelled section, not a note line");

  const waves = collect(graph, (node) => node.type === "li" && String(node.props?.className || "") === "ks-wave");
  assert.equal(waves.length, 2, "one row per wave");
  const first = collect(waves[0], (node) => String(node.props?.className || "") === "ks-wave-task");
  assert.deepEqual(first.map((row) => row.props["data-status"]), ["completed", "in_progress", "not_started"]);
  assert.deepEqual(first.map((row) => textOf(row).trim()), ["2.1 count.js", "3.1 report.js", "4.1 cli.js"], "each task carries its own title");
  assert.match(textOf(waves[0]), /第 1 波/u);
  assert.match(textOf(waves[0]), /1\/3/u, "the wave header counts done over total");
  assert.match(textOf(waves[0]), /并行/u, "a multi-task wave says it runs in parallel");
  assert.doesNotMatch(textOf(waves[0]), /\[2\.1,\s*3\.1/u, "the bracketed id list is gone");

  // A leaf the graph forgot must be called out, never silently dropped.
  assert.match(textOf(graph), /未入依赖图/u);
  assert.match(textOf(graph), /9\.1 orphan/u);
});

test("the pane binds and unbinds the session without changing the spec type", async () => {
  resetHooks();
  const tab = collectTab();
  let bound = null;
  const rpc = createRpc((method, payload) => {
    if (method === "describe") {
      return describeWith({
        activeSpec: bound === null ? null : { feature: bound, specType: "feature", phase: "design" },
        binding: bound === null ? null : { feature: bound },
      });
    }
    if (method === "get") return DETAIL;
    if (method === "bind") { bound = payload.feature; return { binding: { feature: bound }, activeSpec: { feature: bound, specType: "feature", phase: "design" }, draft: null }; }
    if (method === "unbind") { bound = null; return { binding: null, activeSpec: null, draft: null }; }
    return {};
  });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const feature = collect(tree, (node) => node.type === "button" && node.props.role === "treeitem" && node.props["data-state"] === undefined && textOf(node.children).includes("login-revamp"))[0];
  feature.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  buttonByText(tree, "关联本会话").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const bind = rpc.calls.find((call) => call.method === "bind");
  assert.deepEqual(bind.payload, { sessionId: "s1", feature: "login-revamp" });
  buttonByText(tree, "解除关联").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.ok(rpc.calls.some((call) => call.method === "unbind"));
});

test("settings live behind the pane menu and save through the RPC channel", async () => {
  resetHooks();
  const tab = collectTab();
  const rpc = paneRpc();
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  collect(tree, (node) => node.type === "button" && node.props["aria-label"] === "更多")[0].props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  buttonByText(tree, "Spec 设置…").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(tree), /Spec 设置/u);
  const checkboxes = byType(tree, "input").filter((node) => node.props.type === "checkbox");
  checkboxes[0].props.onChange({ target: { checked: false } });
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  buttonByText(tree, "保存").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const save = rpc.calls.find((call) => call.method === "saveSettings");
  assert.equal(save.payload.sessionId, "s1");
  assert.equal(save.payload.values.promptEnabled, false);
});

test("a failed list read is reported with a retry instead of an empty workspace", async () => {
  resetHooks();
  const tab = collectTab();
  let fail = true;
  const rpc = createRpc((method) => {
    if (method === "describe" && fail) throw new Error("offline");
    return describeWith();
  });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(tree), /offline/u);
  fail = false;
  buttonByText(tree, "重试").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(tree), /login-revamp/u);
});

test("a late response for an old feature cannot replace the newly selected one", async () => {
  resetHooks();
  const tab = collectTab();
  let releaseLogin;
  const rpc = createRpc((method, payload) => {
    if (method === "describe") return describeWith();
    if (method === "get" && payload.feature === "login-revamp") {
      return new Promise((resolve) => { releaseLogin = () => resolve(DETAIL); });
    }
    if (method === "get") return TASKS_DETAIL;
    if (method === "document") return { content: "tasks", document: "tasks.md", feature: payload.feature, phase: "execution" };
    return {};
  });
  const tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  // login-revamp is selected first (first spec, no binding); its detail is held.
  const login = collect(tree, (node) => node.type === "button" && node.props.role === "treeitem" && node.props["data-state"] === undefined && textOf(node.children).includes("login-revamp"))[0];
  login.props.onClick();
  await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const withRows = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const checkout = collect(withRows, (node) => node.type === "button" && node.props["data-state"] === undefined && textOf(node.children).includes("checkout-flow"))[0];
  assert.ok(checkout);
  checkout.props.onClick();
  await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  releaseLogin();
  const final = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(final), /checkout-flow/u);
  assert.doesNotMatch(textOf(final), /Fast login/u);
});

test("becoming active again reloads the open document", async () => {
  resetHooks();
  const tab = collectTab();
  let revision = 1;
  const rpc = paneRpc({ document: (payload) => ({ feature: payload.feature, document: `${payload.document}.md`, content: `revision ${revision}`, phase: "design" }) });
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const feature = collect(tree, (node) => node.type === "button" && node.props.role === "treeitem" && node.props["data-state"] === undefined && textOf(node.children).includes("login-revamp"))[0];
  feature.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const design = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Design"))[0];
  design.props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(tree), /revision 1/u);
  // The Agent rewrites design.md while the tab is in the background.
  revision = 7;
  await settle(tab, { rpcCall: rpc, sessionId: "s1", active: false });
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  assert.match(textOf(tree), /revision 7/u);
});

test("the view fills the conversation's viewport and clears the composer", async () => {
  resetHooks();
  const body = collectTab();
  const tree = await settle(body, { rpcCall: paneRpc(), sessionId: "s1" });
  assert.equal(tree.props["aria-label"], "规格");
  assert.equal(tree.props["data-spec-view"], "spec");
  assert.match(tree.props.className, /ks-view/u);
  // The host pins the view area and overlays the composer only for a view that
  // opts in with this attribute (the trajectory view sets it too).
  assert.equal(tree.props["data-conversation-composer-overlay"], "");
  // A conversation view shares the strip's height with the chat flow, so it
  // reserves the composer band and the host's viewport variable.
  assert.match(styles[0].textContent, /--dsh-conversation-viewport-height/u);
  assert.match(styles[0].textContent, /padding-bottom:calc\(var\(--dsh-composer-height,152px\)/u);
  assert.match(styles[0].textContent, /@container\(max-width:620px\)/u);
  assert.match(textOf(tree), /login-revamp/u);
});

test("returning to the view re-reads the disk", async () => {
  // The host unmounts a conversation view when another tab is selected, so the
  // next mount reads the disk again instead of showing what the Agent has since
  // rewritten.
  resetHooks();
  const body = collectTab();
  let revision = 1;
  const rpc = paneRpc({
    describe: () => describeWith({ activeSpec: { feature: "login-revamp", specType: "feature", phase: "design" } }),
    document: () => ({ content: `revision ${revision}` }),
  });
  const props = { rpcCall: rpc, sessionId: "s1" };
  let tree = await settle(body, props);
  const design = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Design"))[0];
  design.props.onClick();
  tree = await settle(body, props);
  assert.match(textOf(tree), /revision 1/u);
  const firstMount = rpc.calls.filter((call) => call.method === "document").length;
  assert.ok(firstMount > 0, "the first mount reads the document");

  // Another tab is selected: the host unmounts this view, and the Agent
  // rewrites the file while it is gone.
  resetHooks();
  revision = 5;
  const readsWhileGone = rpc.calls.filter((call) => call.method === "document").length;
  assert.equal(readsWhileGone, firstMount, "an unmounted view must not keep reading");

  tree = await settle(body, props);
  // The remount starts with nothing selected, so pick Design again and check
  // that the fresh read — not a cached one — is what shows up.
  const designAgain = collect(tree, (node) => node.type === "button" && node.props["data-state"] !== undefined && textOf(node.children).includes("Design"))[0];
  designAgain.props.onClick();
  tree = await settle(body, props);
  assert.match(textOf(tree), /revision 5/u, "coming back to the tab reads the disk");
});

test("the view's inject preserves the current session for RPC calls", async () => {
  resetHooks();
  const calls = [];
  const host = makeContext({ connection: { rpc: { call: async (channel, method, payload) => {
    calls.push({ channel, method, payload });
    return { ok: true, value: describeWith() };
  } } } });
  const view = entryOf(host, "conversation.view");
  const sessions = { byId: { "session-two": { projectionValues: { agentPreset: "spec" } } } };
  await settle(view.component, { ...view.options.inject("session-two"), useSessions: (select) => select(sessions) });
  assert.deepEqual(calls[0], { channel: "/dsh-spec", method: "describe", payload: { sessionId: "session-two" } });
});

test("the view renders nothing for a session that is not in Spec mode", async () => {
  resetHooks();
  const body = collectTab({ byId: { s1: { projectionValues: { agentPreset: "standard" } } } });
  const rpc = paneRpc();
  const tree = await settle(body, { rpcCall: rpc, sessionId: "s1" });
  assert.equal(tree, null, "a stale occurrence of the tab must not render");
  assert.equal(rpc.calls.length, 0, "and it must not read the disk either");
});

// ---------------------------------------------------------------------------
// Plan dock — the Spec preset's own task list
// ---------------------------------------------------------------------------
const PLAN = {
  feature: "wc-lite-cli",
  phase: "execution",
  workflowType: "requirements-first",
  counts: { total: 4, done: 2, active: 1, queued: 0, pending: 1, percent: 50 },
  waves: [
    { id: 0, open: false, tasks: [{ id: "1.1", title: "Scaffold", status: "completed", optional: false, derived: false, requirements: [] }] },
    { id: 1, open: true, tasks: [
      { id: "2.1", title: "count.js", status: "in_progress", optional: false, derived: false, requirements: ["1.1"] },
      { id: "2.2", title: "property tests", status: "in_progress", optional: true, derived: false, requirements: [] },
      { id: "2.3", title: "report.js", status: "not_started", optional: false, derived: false, requirements: [] },
    ] },
  ],
  unscheduled: [{ id: "9", title: "Loose task", status: "not_started", optional: false, derived: false, requirements: [] }],
};

function dockTree(plan, extra = {}) {
  const host = makeContext();
  const entry = entryOf(host, "conversation.input.dock");
  const Body = entry.component;
  return settle(Body, { useProjection: () => plan, ...extra });
}

test("a session with no published plan re-syncs from disk instead of hiding", async () => {
  // The projection only learns about a spec when a tool writes it, so a spec
  // bound to a session that has not written anything yet has no plan event.
  // The dock reads it once on mount and renders the snapshot it got back.
  resetHooks();
  const calls = [];
  const rpcCall = async (method, payload) => {
    calls.push({ method, payload });
    return PLAN;
  };
  const tree = await dockTree(null, { rpcCall });
  assert.deepEqual(calls.map((call) => call.method), ["resync"]);
  assert.ok(tree, "the dock paints the re-synced plan");
  assert.equal(tree.props["data-spec-plan"], "wc-lite-cli");
  assert.match(textOf(tree), /2 进行中/u);
});

test("the re-sync leaves a published plan alone and never multiplies calls", async () => {
  resetHooks();
  const calls = [];
  const rpcCall = async (method) => {
    calls.push(method);
    return PLAN;
  };
  const tree = await dockTree(PLAN, { rpcCall });
  assert.deepEqual(calls, [], "a live projection is the only source while it exists");
  assert.equal(tree.props["data-spec-plan"], "wc-lite-cli");
});

test("a failed re-sync hides the dock and never breaks the composer", async () => {
  resetHooks();
  const tree = await dockTree(null, { rpcCall: async () => { throw new Error("offline"); } });
  assert.equal(tree, null);
});

test("the plan dock replaces the host todo list in the composer dock", () => {
  const host = makeContext();
  const entry = entryOf(host, "conversation.input.dock");
  assert.ok(entry, "the dock slot carries a Spec entry");
  assert.equal(entry.options.id, "dsh-spec-plan");
  // Without `inject` the dock never receives an RPC handle, so the cold-start
  // re-sync silently never ran and an existing spec showed no panel.
  assert.equal(typeof entry.options.inject, "function", "the dock needs the RPC handle");
  assert.equal(typeof entry.options.inject("s1").rpcCall, "function");
  assert.equal(entry.options.inject("s1").sessionId, "s1");
  // Above the host's own todo dock (order 0) if a deployment still mounts it.
  assert.ok(entry.options.order < 0, "the plan dock sits above the host todo dock");
});

test("the dock renders nothing until a plan exists", async () => {
  for (const empty of [null, undefined]) {
    resetHooks();
    const tree = await dockTree(empty);
    assert.equal(tree, null, "no plan means no dock");
  }
  resetHooks();
  const noHook = await settle(entryOf(makeContext(), "conversation.input.dock").component, {});
  assert.equal(noHook, null, "a host without useProjection renders nothing rather than guessing");
});

test("the dock summarises done and parallel in-progress work", async () => {
  resetHooks();
  const tree = await dockTree(PLAN);
  assert.equal(tree.props["data-spec-plan"], "wc-lite-cli");
  const text = textOf(tree);
  // Two tasks running at once is the parallel case the host todo cannot express.
  assert.match(text, /2 完成/u);
  assert.match(text, /2 进行中/u);
  assert.match(text, /1 待开始/u);
  assert.match(text, /wc-lite-cli/u);
});

test("expanding shows every wave and keeps parallel tasks side by side", async () => {
  resetHooks();
  const tree = await dockTree(PLAN);
  const head = collect(tree, (node) => node.type === "button" && node.props["aria-expanded"] !== undefined)[0];
  assert.equal(head.props["aria-expanded"], "false", "collapsed by default");
  head.props.onClick();
  const open = await dockTree(PLAN);
  const expanded = collect(open, (node) => node.type === "button" && node.props["aria-expanded"] !== undefined)[0];
  assert.equal(expanded.props["aria-expanded"], "true");
  const rows = collect(open, (node) => node.props && node.props.className === "ks-plan-task");
  assert.deepEqual(rows.map((row) => row.props["data-status"]), [
    "completed", "in_progress", "in_progress", "not_started", "not_started",
  ], "wave 1 keeps both running tasks and the loose task is rendered too");
  assert.equal(textOf(open).includes("Wave 0"), true);
  assert.equal(textOf(open).includes("未入依赖图"), true, "an un-graphed leaf is called out, not hidden");
  assert.equal(rows.filter((row) => row.props["data-status"] === "in_progress").length, 2);
});

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------
test("without the locale plugin the panel speaks the browser's language", async () => {
  resetHooks();
  const tab = collectTab();
  const rpc = paneRpc();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-US" } });
  try {
    const tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
    const text = textOf(tree);
    // The tab label, the header and the tree copy all move together: an
    // English browser must not get a Chinese panel with English document names.
    assert.match(text, /Specs/u);
    assert.match(text, /Refresh/u);
    assert.doesNotMatch(text, /刷新|新建 Spec|规格/u);
  } finally {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "zh-CN" } });
  }
});

test("the tab label is a thunk so the host can re-resolve it on a locale switch", () => {
  const host = makeContext();
  const view = entryOf(host, "conversation.view");
  assert.equal(typeof view.options.label, "function");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "zh-CN" } });
  assert.equal(view.options.label(), "规格");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-US" } });
  assert.equal(view.options.label(), "Specs");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "zh-CN" } });
});

test("the settings panel offers a language that defaults to following DSH", async () => {
  resetHooks();
  const tab = collectTab();
  const rpc = paneRpc();
  let tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  collect(tree, (node) => node.type === "button" && node.props["aria-label"] === "更多")[0].props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  buttonByText(tree, "Spec 设置…").props.onClick();
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const select = collect(tree, (node) => node.type === "select" && textOf(node.children).includes("跟随 DSH"))[0];
  assert.ok(select, "the language select exists and offers 跟随 DSH");
  assert.equal(select.props.value, "", "empty means follow DSH, which is the default");
  const options = collect(select, (node) => node.type === "option").map((node) => node.props.value);
  assert.deepEqual(options, ["", "zh", "en"]);
  // Switching it reaches the server with the rest of the settings.
  select.props.onChange({ target: { value: "en" } });
  tree = await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  buttonByText(tree, "保存").props.onClick();
  await settle(tab, { rpcCall: rpc, sessionId: "s1", active: true });
  const save = rpc.calls.find((call) => call.method === "saveSettings");
  assert.equal(save.payload.values.language, "en");
});
