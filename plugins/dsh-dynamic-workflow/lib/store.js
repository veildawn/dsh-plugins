/**
 * Run store: folds DSH workflow-engine events, static `workflow` script plans,
 * and the parent session's `tool-workflow/*` records into one graph per run
 * (phases as station lanes, agents & script blocks as capsule pills, phase edges
 * in declaration order).
 *
 * Every handler is an idempotent upsert, because the same fact can arrive
 * twice: once from the engine (`workflow/agent-start`) and once from the
 * session log (`tool-workflow/agent-start`). Either source alone is enough to
 * build the graph; the engine adds phases and log lines, the session adds the
 * owning session id and `workflow` tool script.
 *
 * @module dsh-dynamic-workflow/store
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RUN_STATUS = ['running', 'completed', 'error', 'cancelled', 'interrupted'];
export const NODE_STATUS = ['running', 'completed', 'failed', 'cancelled', 'interrupted'];

const MAX_LOGS = 400;
const MAX_SCRIPT = 256_000;
const UNPHASED = '';

function text(value, max = 2000) {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

function stopToStatus(reason) {
  if (reason === 'completed') return 'completed';
  if (reason === 'cancelled') return 'cancelled';
  return 'error';
}

function promptPreviewLabel(prompt) {
  if (typeof prompt !== 'string') return '';
  const trimmed = prompt.trim();
  if (trimmed === '') return '';
  const nl = trimmed.indexOf('\n');
  const line = nl === -1 ? trimmed : trimmed.slice(0, nl).trim();
  return line.length <= 48 ? line : `${line.slice(0, 47)}…`;
}

const REGEX_PREV_PUNC = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';']);
const REGEX_PREV_KW = new Set(['return', 'throw', 'case', 'typeof', 'void', 'delete', 'in', 'of', 'await', 'yield']);

/**
 * Lightweight JS lexical scanner for workflow scripts. Strips comments and
 * extracts string/template literals, identifiers, and punctuation without
 * executing untrusted code or failing on syntax extensions.
 */
function tokenizeScript(source) {
  const tokens = [];
  const len = source.length;
  let i = 0;

  const canStartRegex = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.type === 'punc' && REGEX_PREV_PUNC.has(prev.value)) return true;
    if (prev.type === 'id' && REGEX_PREV_KW.has(prev.value)) return true;
    return false;
  };

  const readEscapedQuote = (quote) => {
    let out = '';
    i += 1;
    while (i < len) {
      const ch = source[i];
      if (ch === '\\') {
        const next = source[i + 1];
        if (next === 'n') out += '\n';
        else if (next === 't') out += '\t';
        else if (next !== undefined) out += next;
        i += 2;
        continue;
      }
      if (ch === quote) {
        i += 1;
        break;
      }
      out += ch;
      i += 1;
    }
    return out;
  };

  const readTemplate = (emit = true) => {
    const parts = [];
    let current = '';
    let dynamic = false;
    i += 1; // skip opening `
    while (i < len) {
      const ch = source[i];
      if (ch === '\\') {
        const next = source[i + 1];
        if (next !== undefined) current += next === 'n' ? '\n' : next;
        i += 2;
        continue;
      }
      if (ch === '`') {
        i += 1;
        break;
      }
      if (ch === '$' && source[i + 1] === '{') {
        parts.push(current);
        current = '';
        dynamic = true;
        i += 2;
        let depth = 1;
        while (i < len && depth > 0) {
          const c = source[i];
          if (c === '\'' || c === '"') { readEscapedQuote(c); continue; }
          if (c === '`') { readTemplate(false); continue; }
          if (c === '/' && source[i + 1] === '/') {
            i += 2;
            while (i < len && source[i] !== '\n') i += 1;
            continue;
          }
          if (c === '/' && source[i + 1] === '*') {
            i += 2;
            while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
            i += 2;
            continue;
          }
          if (c === '{') depth += 1;
          else if (c === '}') depth -= 1;
          i += 1;
        }
        continue;
      }
      current += ch;
      i += 1;
    }
    parts.push(current);
    if (emit) tokens.push({ type: dynamic ? 'tpl' : 'str', value: parts[0] ?? '', parts });
  };

  while (i < len) {
    const ch = source[i];
    if (ch <= ' ') { i += 1; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      tokens.push({ type: 'str', value: readEscapedQuote(ch) });
      continue;
    }
    if (ch === '`') {
      readTemplate();
      continue;
    }
    if (ch === '/' && canStartRegex()) {
      i += 1;
      let inClass = false;
      while (i < len) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i += 1; break; }
        else if (c === '\n') break;
        i += 1;
      }
      while (i < len && /[a-z]/i.test(source[i])) i += 1;
      tokens.push({ type: 'rx', value: '' });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < len && /[A-Za-z0-9_$]/.test(source[i])) i += 1;
      tokens.push({ type: 'id', value: source.slice(start, i) });
      continue;
    }
    if ('(){}[],:;.?=!+-*&|<>'.includes(ch)) {
      tokens.push({ type: 'punc', value: ch });
      i += 1;
      continue;
    }
    i += 1;
  }
  return tokens;
}

function findMatchingClose(tokens, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.type === 'punc') {
      if (tok.value === openChar) depth += 1;
      else if (tok.value === closeChar) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return tokens.length - 1;
}

function cleanTemplateLabel(parts) {
  if (!Array.isArray(parts)) return '';
  const cleaned = parts
    .map((seg) => seg.replace(/^[\s·•\-_:：/\\|#]+|[\s·•\-_:：/\\|#]+$/gu, '').trim())
    .filter(Boolean);
  if (cleaned.length === 0) return '';
  const joined = text(cleaned.join('·'), 200);
  return /^(?:agent|subagent)s?$/iu.test(joined) ? '' : joined;
}

function resolveStaticStr(tok, constStrings) {
  if (!tok) return '';
  if (tok.type === 'str') return tok.value;
  if (tok.type === 'id' && constStrings && constStrings.has(tok.value)) return constStrings.get(tok.value);
  return '';
}

function readAgentCallOptions(tokens, start, end, constStrings) {
  // Locate top-level comma separating `prompt` from `opts` inside `agent(...)`.
  let depth = 0;
  let comma = -1;
  for (let i = start; i < end; i += 1) {
    const tok = tokens[i];
    if (tok.type === 'punc') {
      if (tok.value === '(' || tok.value === '{' || tok.value === '[') depth += 1;
      else if (tok.value === ')' || tok.value === '}' || tok.value === ']') depth -= 1;
      else if (tok.value === ',' && depth === 0) { comma = i; break; }
    }
  }
  const opts = { label: '', phase: '', model: '', provider: '', hasStaticLabel: false, hasLabelKey: false };
  if (comma === -1) return opts;
  let brace = -1;
  for (let i = comma + 1; i < end; i += 1) {
    if (tokens[i].type === 'punc' && tokens[i].value === '{') { brace = i; break; }
    if (tokens[i].type !== 'punc') break;
  }
  if (brace === -1) return opts;
  const braceEnd = Math.min(end, findMatchingClose(tokens, brace, '{', '}'));
  let innerDepth = 0;
  for (let i = brace + 1; i < braceEnd; i += 1) {
    const tok = tokens[i];
    if (tok.type === 'punc') {
      if (tok.value === '(' || tok.value === '{' || tok.value === '[') innerDepth += 1;
      else if (tok.value === ')' || tok.value === '}' || tok.value === ']') innerDepth -= 1;
      continue;
    }
    if (innerDepth !== 0) continue;
    const prevTok = tokens[i - 1];
    const atPropStart = prevTok && prevTok.type === 'punc' && (prevTok.value === '{' || prevTok.value === ',');
    if (!atPropStart) continue;
    const key = (tok.type === 'id' || tok.type === 'str') ? tok.value : '';
    if (!key) continue;
    const nextTok = tokens[i + 1];
    if (nextTok && nextTok.type === 'punc' && nextTok.value === ':') {
      const val = tokens[i + 2];
      if (!val) continue;
      if (key === 'label') {
        opts.hasLabelKey = true;
        const staticVal = resolveStaticStr(val, constStrings).trim();
        if (staticVal !== '') {
          opts.label = staticVal;
          opts.hasStaticLabel = true;
        } else if (val.type === 'tpl') {
          opts.label = cleanTemplateLabel(val.parts);
        }
      } else if (key === 'phase' || key === 'model' || key === 'provider') {
        const staticVal = resolveStaticStr(val, constStrings);
        if (staticVal !== '') opts[key] = staticVal;
      }
      continue;
    }
    // ES6 property shorthand: `{ label }` / `{ label, phase, model, provider }`
    if (tok.type === 'id' && (!nextTok || (nextTok.type === 'punc' && (nextTok.value === ',' || nextTok.value === '}' || nextTok.value === '=')))) {
      if (key === 'label') {
        opts.hasLabelKey = true;
        const staticVal = resolveStaticStr(tok, constStrings).trim();
        if (staticVal !== '') {
          opts.label = staticVal;
          opts.hasStaticLabel = true;
        }
      } else if (key === 'phase' || key === 'model' || key === 'provider') {
        const staticVal = resolveStaticStr(tok, constStrings);
        if (staticVal !== '') opts[key] = staticVal;
      }
    }
  }
  return opts;
}

const SCRIPT_WORK_METHODS = new Set(['filter', 'reduce', 'flatMap', 'every', 'some', 'sort', 'parse', 'stringify']);

/**
 * Pre-analyze a `workflow` script into planned phases, `agent()` sites, and
 * `>_ 脚本` orchestration steps so future phases and skipped conditional agents
 * appear on the timeline immediately before runtime events fire.
 */
export function parseScriptPlan(script) {
  const empty = { phases: [], byPhase: new Map() };
  if (typeof script !== 'string' || script.trim() === '') return empty;
  const tokens = tokenizeScript(script.slice(0, MAX_SCRIPT));
  if (tokens.length === 0) return empty;

  const phases = [];
  const byPhase = new Map();
  const hasScriptItem = new Set();
  const constStrings = new Map();
  const blockPhaseStack = [];
  let currentPhase = null;

  const ensurePhase = (title) => {
    if (!byPhase.has(title)) {
      byPhase.set(title, []);
      if (title !== UNPHASED && !phases.includes(title)) phases.push(title);
    }
    return byPhase.get(title);
  };

  const addScriptStep = (title) => {
    if (title === null || title === UNPHASED || hasScriptItem.has(title)) return;
    hasScriptItem.add(title);
    ensurePhase(title).push({ kind: 'script', label: '', phase: title });
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.type === 'punc') {
      if (tok.value === '{') blockPhaseStack.push(null);
      else if (tok.value === '}' && blockPhaseStack.length > 0) blockPhaseStack.pop();
      continue;
    }
    const prev = tokens[i - 1];
    const isDotProp = prev && prev.type === 'punc' && prev.value === '.';
    const isDecl = prev && prev.type === 'id' && (prev.value === 'function' || prev.value === 'const' || prev.value === 'let' || prev.value === 'var');

    if (isDecl && tok.type === 'id' && prev.value !== 'function') {
      const eq = tokens[i + 1];
      const rhs = tokens[i + 2];
      const afterRhs = tokens[i + 3];
      if (blockPhaseStack.length === 0 && eq?.type === 'punc' && eq.value === '=' && rhs?.type === 'str' && (!afterRhs || (afterRhs.type === 'punc' && (afterRhs.value === ';' || afterRhs.value === ',')) || afterRhs.type === 'id')) {
        constStrings.set(tok.value, rhs.value);
      } else {
        constStrings.delete(tok.value);
      }
    } else if (!isDotProp && tok.type === 'id' && tokens[i + 1]?.type === 'punc' && tokens[i + 1].value === '=') {
      constStrings.delete(tok.value);
    }

    if (tok.type === 'id' && !isDotProp && !isDecl && tok.value === 'phase') {
      const next = tokens[i + 1];
      const arg = tokens[i + 2];
      const phaseTitle = (arg?.type === 'str' || arg?.type === 'tpl') ? arg.value : resolveStaticStr(arg, constStrings);
      if (next?.type === 'punc' && next.value === '(' && phaseTitle.trim() !== '') {
        currentPhase = text(phaseTitle, 128);
        if (blockPhaseStack.length > 0) blockPhaseStack[blockPhaseStack.length - 1] = currentPhase;
        ensurePhase(currentPhase);
        i = findMatchingClose(tokens, i + 1, '(', ')');
        continue;
      }
    }

    if (tok.type === 'id' && !isDotProp && !isDecl && tok.value === 'agent') {
      const next = tokens[i + 1];
      if (next?.type === 'punc' && next.value === '(') {
        const closeIdx = findMatchingClose(tokens, i + 1, '(', ')');
        const firstArg = tokens[i + 2];
        const promptStr = (firstArg?.type === 'str' || firstArg?.type === 'tpl') ? firstArg.value : resolveStaticStr(firstArg, constStrings);
        const opts = readAgentCallOptions(tokens, i + 2, closeIdx, constStrings);
        const explicitPhase = opts.phase ? text(opts.phase, 128) : '';
        const targetPhase = explicitPhase || (currentPhase ?? UNPHASED);
        if (explicitPhase && blockPhaseStack.length > 0) {
          blockPhaseStack[blockPhaseStack.length - 1] = explicitPhase;
        }
        const rawFallback = promptPreviewLabel(promptStr);
        const fallback = /^(?:agent|subagent)$/iu.test(rawFallback) ? '' : rawFallback;
        const label = text(opts.label, 200) || (opts.hasLabelKey ? '' : fallback);
        if (label || targetPhase !== UNPHASED) {
          ensurePhase(targetPhase).push({
            kind: 'agent',
            label: label || '',
            dynamicLabel: !opts.hasStaticLabel && (opts.hasLabelKey || firstArg?.type !== 'str' || fallback === ''),
            phase: targetPhase,
            model: opts.model ? text(opts.model, 120) : null,
            provider: opts.provider ? text(opts.provider, 120) : null,
          });
        }
        i = closeIdx;
        continue;
      }
    }

    const activeScriptPhase = (blockPhaseStack.length > 0 ? blockPhaseStack[blockPhaseStack.length - 1] : null) ?? currentPhase;
    if (activeScriptPhase !== null) {
      if (tok.type === 'id' && !isDotProp && !isDecl && tok.value === 'log' && tokens[i + 1]?.type === 'punc' && tokens[i + 1].value === '(') {
        addScriptStep(activeScriptPhase);
      } else if (tok.type === 'id' && !isDotProp && (tok.value === 'for' || tok.value === 'while' || tok.value === 'switch' || tok.value === 'try')) {
        addScriptStep(activeScriptPhase);
      } else if (tok.type === 'id' && isDotProp && SCRIPT_WORK_METHODS.has(tok.value) && tokens[i + 1]?.type === 'punc' && tokens[i + 1].value === '(') {
        addScriptStep(activeScriptPhase);
      }
    }
  }

  // Any explicitly entered `phase("...")` block in the script that spawns zero agents is a pure script phase.
  for (const title of phases) {
    const items = byPhase.get(title);
    if (items && items.length === 0) addScriptStep(title);
  }

  return { phases, byPhase };
}

function getPlan(run) {
  if (!run.script) return { phases: [], byPhase: new Map() };
  if (run._planCache && run._planCacheScript === run.script) return run._planCache;
  const parsed = parseScriptPlan(run.script);
  Object.defineProperty(run, '_planCache', { value: parsed, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(run, '_planCacheScript', { value: run.script, writable: true, configurable: true, enumerable: false });
  return parsed;
}

/** Nodes with their model: the child's observed model, else the phase's declared one. */
function nodesWithModels(run) {
  return run.nodes.map((node) => {
    const declared = run.declaredPhases.find((phase) => phase.title === node.phase);
    return {
      ...node,
      model: node.model ?? declared?.model ?? null,
      modelDeclared: node.model == null && Boolean(declared?.model),
    };
  });
}

function reconcileLaneItems(laneIndex, title, laneState, visited, declared, liveNodes, planned) {
  if (!planned || planned.length === 0) {
    return liveNodes.map((node) => ({
      ...node,
      key: `n${node.seq}`,
      kind: 'agent',
    }));
  }

  // Count how many planned slots share each static label in this phase.
  const labelQuota = new Map();
  for (const item of planned) {
    if (item.kind === 'agent' && !item.dynamicLabel) {
      labelQuota.set(item.label, (labelQuota.get(item.label) ?? 0) + 1);
    }
  }

  const usedSeqs = new Set();
  const resolved = planned.map((planItem, idx) => {
    if (planItem.kind !== 'agent') return { planItem, idx, matched: [] };
    if (planItem.dynamicLabel) {
      // Dynamic fanout (`pipeline` / `parallel` without static label): claim unmatched live nodes.
      const unclaimed = liveNodes.filter((n) => !usedSeqs.has(n.seq) && !labelQuota.has(n.label));
      for (const n of unclaimed) usedSeqs.add(n.seq);
      return { planItem, idx, matched: unclaimed };
    }
    const candidates = liveNodes.filter((n) => !usedSeqs.has(n.seq) && n.label === planItem.label);
    const remainingSlots = labelQuota.get(planItem.label) ?? 1;
    labelQuota.set(planItem.label, Math.max(0, remainingSlots - 1));
    const take = remainingSlots > 1 ? candidates.slice(0, 1) : candidates;
    for (const n of take) usedSeqs.add(n.seq);
    return { planItem, idx, matched: take };
  });

  const items = [];
  for (let idx = 0; idx < resolved.length; idx += 1) {
    const entry = resolved[idx];
    const { planItem } = entry;
    if (planItem.kind === 'script') {
      let status = 'pending';
      if (visited) {
        if (laneState === 'done') {
          status = 'completed';
        } else if (laneState === 'failed') {
          const anyAgentFailed = liveNodes.some((n) => n.status === 'failed');
          const afterStarted = resolved.slice(idx + 1).some((r) => r.matched.length > 0);
          status = afterStarted ? 'completed' : (anyAgentFailed ? 'pending' : 'failed');
        } else if (laneState === 'cancelled') {
          const afterStarted = resolved.slice(idx + 1).some((r) => r.matched.length > 0);
          const haltedBefore = resolved.slice(0, idx).some((r) =>
            r.planItem.kind === 'agent' && (
              r.matched.some((n) => n.status === 'cancelled' || n.status === 'interrupted')
              || (!r.planItem.dynamicLabel && r.matched.length === 0 && liveNodes.length === 0)
            ),
          );
          status = afterStarted ? 'completed' : (haltedBefore ? 'pending' : 'cancelled');
        } else if (laneState === 'running') {
          const afterStarted = resolved.slice(idx + 1).some((r) => r.matched.length > 0);
          const beforeBlocking = resolved.slice(0, idx).some((r) =>
            r.planItem.kind === 'agent' && (r.matched.some((n) => n.status === 'running') || (!r.planItem.dynamicLabel && r.matched.length === 0 && liveNodes.length === 0)),
          );
          if (afterStarted) status = 'completed';
          else if (beforeBlocking) status = 'pending';
          else status = 'running';
        }
      }
      items.push({
        key: `script-${laneIndex}-${idx}`,
        kind: 'script',
        seq: null,
        label: planItem.label || '',
        phase: title,
        status,
      });
      continue;
    }

    if (entry.matched.length > 0) {
      for (const node of entry.matched) {
        items.push({ ...node, key: `n${node.seq}`, kind: 'agent' });
      }
    } else if (!planItem.dynamicLabel || liveNodes.length === 0) {
      items.push({
        key: `plan-${laneIndex}-${idx}`,
        kind: 'agent',
        seq: null,
        label: planItem.label,
        phase: title,
        childId: null,
        provider: planItem.provider ?? null,
        model: planItem.model ?? declared?.model ?? null,
        modelDeclared: Boolean(planItem.model || declared?.model),
        status: 'pending',
        startedAt: null,
        endedAt: null,
      });
    }
  }

  for (const node of liveNodes) {
    if (!usedSeqs.has(node.seq)) {
      items.push({ ...node, key: `n${node.seq}`, kind: 'agent' });
    }
  }
  return items;
}

/**
 * Build the phase lanes for one run: declared phases first, in `meta.phases`
 * order, then phases discovered statically in `script` or seen at runtime,
 * then an unphased lane when needed.
 */
export function phaseLanes(run) {
  const plan = getPlan(run);
  const allNodes = nodesWithModels(run);
  const order = [];
  const seen = new Set();
  const push = (title) => {
    if (seen.has(title)) return;
    seen.add(title);
    order.push(title);
  };
  for (const phase of run.declaredPhases) push(phase.title);
  for (const title of plan.phases) push(title);
  for (const title of run.seenPhases) push(title);
  for (const node of allNodes) push(node.phase ?? UNPHASED);
  if (order.length > 1 && order.includes(UNPHASED)) {
    const hasUnphasedWork = allNodes.some((n) => (n.phase ?? UNPHASED) === UNPHASED);
    if (!hasUnphasedWork) order.splice(order.indexOf(UNPHASED), 1);
  }

  const roleSlots = new Map();
  const lastSeen = run.seenPhases[run.seenPhases.length - 1] ?? null;

  return order.map((title, index) => {
    const declared = run.declaredPhases.find((phase) => phase.title === title);
    const nodes = allNodes.filter((node) => (node.phase ?? UNPHASED) === title);
    const counts = { running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 };
    for (const node of nodes) counts[node.status] = (counts[node.status] ?? 0) + 1;
    const visited = run.seenPhases.includes(title) || nodes.length > 0;

    let state = 'pending';
    if (counts.running > 0) state = 'running';
    else if (run.status === 'running' && run.currentPhase === title && counts.failed === 0) state = 'running';
    else if (nodes.length > 0) {
      if (counts.failed > 0) state = 'failed';
      else if ((counts.cancelled > 0 || counts.interrupted > 0) && counts.completed < nodes.length) state = 'cancelled';
      else state = 'done';
    }
    if (state === 'pending' && visited && (run.currentPhase !== title || run.status !== 'running')) {
      if (run.status === 'error' && lastSeen === title) state = 'failed';
      else if ((run.status === 'cancelled' || run.status === 'interrupted') && lastSeen === title) state = 'cancelled';
      else state = 'done';
    }
    if (state === 'pending' && run.status !== 'running' && !visited) state = 'skipped';

    const items = reconcileLaneItems(index, title, state, visited, declared, nodes, plan.byPhase.get(title));
    const seenInLane = new Map();
    for (const item of items) {
      if (item.kind !== 'agent') continue;
      const roleName = item.label || title || 'subagent';
      const occ = (seenInLane.get(roleName) ?? 0) + 1;
      seenInLane.set(roleName, occ);
      const roleKey = `${roleName}@${occ}`;
      if (!roleSlots.has(roleKey)) roleSlots.set(roleKey, roleSlots.size);
      item.avatarSlot = roleSlots.get(roleKey);
    }

    return {
      id: `p${index}`,
      title,
      detail: declared?.detail ?? '',
      model: declared?.model ?? '',
      declared: declared !== undefined,
      state,
      counts,
      nodes: nodes.map((node) => node.seq),
      items,
    };
  });
}

/** Phase edges in lane order: the orchestration a reader follows left to right. */
export function phaseEdges(lanes) {
  const edges = [];
  for (let i = 1; i < lanes.length; i += 1) edges.push({ from: lanes[i - 1].id, to: lanes[i].id });
  return edges;
}

function activeRunModel(run) {
  for (const node of run.nodes) {
    if (node.status === 'running' && node.model) return node.model;
  }
  for (let i = run.nodes.length - 1; i >= 0; i -= 1) {
    if (run.nodes[i].model) return run.nodes[i].model;
  }
  if (run.currentPhase) {
    const activeDeclared = run.declaredPhases.find((p) => p.title === run.currentPhase);
    if (activeDeclared?.model) return activeDeclared.model;
  }
  for (const phase of run.declaredPhases) {
    if (phase.model) return phase.model;
  }
  return run.sessionModel || null;
}

export function summaryOf(run) {
  const counts = { running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 };
  for (const node of run.nodes) counts[node.status] = (counts[node.status] ?? 0) + 1;
  const plan = getPlan(run);
  return {
    id: run.id,
    name: run.name,
    description: run.description,
    sessionId: run.sessionId,
    status: run.status,
    currentPhase: run.currentPhase,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    agents: run.nodes.length,
    counts,
    phases: run.declaredPhases.length || plan.phases.length || run.seenPhases.length,
    model: activeRunModel(run),
    background: run.background,
    error: run.error,
    rev: run.rev,
    hasScript: run.script !== '',
  };
}

export function detailOf(run) {
  const lanes = phaseLanes(run);
  return {
    ...summaryOf(run),
    whenToUse: run.whenToUse,
    background: run.background,
    agentsStarted: run.agentsStarted,
    graph: { lanes, edges: phaseEdges(lanes) },
    nodes: nodesWithModels(run),
    logs: run.logs.slice(-MAX_LOGS),
    script: run.script,
    args: run.args,
    meta: run.meta,
  };
}

/** What the composer dock needs: the graph and nodes, without script, args and logs. */
export function dockDetailOf(run) {
  const lanes = phaseLanes(run);
  return { ...summaryOf(run), graph: { lanes, edges: phaseEdges(lanes) }, nodes: nodesWithModels(run) };
}

function freshRun(id, now) {
  return {
    id,
    name: '',
    description: '',
    whenToUse: '',
    meta: null,
    declaredPhases: [],
    seenPhases: [],
    sessionId: null,
    sessionProvider: null,
    sessionModel: null,
    callId: null,
    status: 'running',
    currentPhase: null,
    startedAt: now,
    endedAt: null,
    stopReason: null,
    error: '',
    agentsStarted: 0,
    background: false,
    nodes: [],
    logs: [],
    script: '',
    args: null,
    rev: 0,
  };
}

function applyMeta(run, meta) {
  if (meta === null || typeof meta !== 'object') return;
  run.meta = {
    name: text(meta.name, 200),
    description: text(meta.description, 500),
    ...(typeof meta.whenToUse === 'string' ? { whenToUse: text(meta.whenToUse, 500) } : {}),
    ...(Array.isArray(meta.phases) ? { phases: meta.phases } : {}),
  };
  if (run.name === '') run.name = run.meta.name;
  run.description = run.meta.description;
  run.whenToUse = run.meta.whenToUse ?? '';
  if (Array.isArray(meta.phases)) {
    run.declaredPhases = meta.phases
      .filter((phase) => phase && typeof phase.title === 'string' && phase.title !== '')
      .slice(0, 32)
      .map((phase) => ({
        title: text(phase.title, 128),
        ...(typeof phase.detail === 'string' ? { detail: text(phase.detail, 300) } : {}),
        ...(typeof phase.model === 'string' ? { model: text(phase.model, 100) } : {}),
      }));
  }
}

/**
 * Create the in-memory store with optional JSON persistence under `dir`.
 * @param {{dir?: string, now?: () => number, maxRuns?: number, persistDelayMs?: number, logger?: object}} options
 */
export function createRunStore(options = {}) {
  const now = options.now ?? Date.now;
  const maxRuns = options.maxRuns ?? 200;
  const dir = options.dir ? path.join(options.dir, 'runs') : null;
  const persistDelayMs = options.persistDelayMs ?? 400;
  const logger = options.logger;
  const runs = new Map();
  /** sessionId -> workflow tool calls not yet matched to a run, oldest first. */
  const pendingCalls = new Map();
  const timers = new Map();
  /** childId -> { runId, seq }: lets a child session's model reach its node. */
  const childIndex = new Map();
  /** sessionId -> { provider, model }: fallback parent-session model for active runs. */
  const sessionModels = new Map();
  let rev = 0;
  let closed = false;

  const warn = (message) => {
    try { logger?.warn?.(message); } catch { /* never break the host */ }
  };

  async function writeRun(run) {
    if (dir === null) return;
    try {
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${run.id}.json`);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(run));
      await rename(tmp, file);
    } catch (error) {
      warn(`dynamic-workflow: cannot persist run ${run.id}: ${error?.message ?? error}`);
    }
  }

  function schedulePersist(run) {
    if (dir === null || closed) return;
    if (timers.has(run.id)) return;
    timers.set(run.id, setTimeout(() => {
      timers.delete(run.id);
      void writeRun(run);
    }, run.status === 'running' ? persistDelayMs : 0));
  }

  function touch(run) {
    rev += 1;
    run.rev = rev;
    schedulePersist(run);
  }

  async function prune() {
    if (runs.size <= maxRuns) return;
    const ordered = [...runs.values()].sort((a, b) => a.startedAt - b.startedAt);
    for (const run of ordered.slice(0, runs.size - maxRuns)) {
      if (run.status === 'running') continue;
      runs.delete(run.id);
      if (dir !== null) await rm(path.join(dir, `${run.id}.json`), { force: true }).catch(() => {});
    }
  }

  function ensure(id) {
    let run = runs.get(id);
    if (run === undefined) {
      run = freshRun(id, now());
      runs.set(id, run);
      void prune();
    }
    return run;
  }

  function inheritSessionModel(run) {
    if (!run.sessionId || run.sessionModel) return;
    const known = sessionModels.get(run.sessionId);
    if (known) {
      run.sessionModel = known.model;
      run.sessionProvider = known.provider;
    }
  }

  /** Attach the oldest unmatched `workflow` tool call of this session with the same name. */
  function claimCall(run) {
    if (run.sessionId === null || run.script !== '') return;
    const queue = pendingCalls.get(run.sessionId);
    if (!queue || queue.length === 0) return;
    let index = queue.findIndex((call) => call.name === run.name);
    if (index === -1) index = 0;
    const [call] = queue.splice(index, 1);
    run.callId = call.callId;
    run.script = call.script;
    run.args = call.args;
    run.background = call.background;
    if (run.meta === null) applyMeta(run, call.meta);
  }

  function upsertNode(run, agent) {
    const seq = Number(agent.seq);
    if (!Number.isSafeInteger(seq) || seq < 1) return null;
    let node = run.nodes.find((candidate) => candidate.seq === seq);
    if (node === undefined) {
      node = {
        seq,
        label: text(agent.label, 200) || `agent #${seq}`,
        phase: typeof agent.phase === 'string' && agent.phase !== '' ? text(agent.phase, 128) : (run.currentPhase ?? null),
        childId: typeof agent.childId === 'string' ? agent.childId : null,
        provider: null,
        model: null,
        status: 'running',
        startedAt: now(),
        endedAt: null,
      };
      if (node.childId !== null) {
        const knownChild = sessionModels.get(node.childId);
        if (knownChild) {
          node.model = knownChild.model;
          node.provider = knownChild.provider;
        }
      }
      run.nodes.push(node);
      run.nodes.sort((a, b) => a.seq - b.seq);
      if (node.childId !== null) childIndex.set(node.childId, { runId: run.id, seq });
      if (node.phase !== null && !run.seenPhases.includes(node.phase)) run.seenPhases.push(node.phase);
    } else {
      if (typeof agent.label === 'string' && agent.label !== '') node.label = text(agent.label, 200);
      if (typeof agent.phase === 'string' && agent.phase !== '') node.phase = text(agent.phase, 128);
      if (typeof agent.childId === 'string') {
        node.childId = agent.childId;
        childIndex.set(agent.childId, { runId: run.id, seq });
      }
    }
    return node;
  }

  function pushLog(run, kind, message) {
    run.logs.push({ time: now(), kind, text: text(message, 2000) });
    if (run.logs.length > MAX_LOGS) run.logs.splice(0, run.logs.length - MAX_LOGS);
  }

  const api = {
    get rev() { return rev; },

    /** Engine `workflow/start`. */
    runStart(info) {
      if (!info || typeof info.id !== 'string') return;
      const run = ensure(info.id);
      applyMeta(run, info.meta);
      pushLog(run, 'start', `▶ ${run.name}`);
      claimCall(run);
      touch(run);
    },

    /** Engine `workflow/phase`. */
    phase(info, title) {
      if (!info || typeof info.id !== 'string' || typeof title !== 'string') return;
      const run = ensure(info.id);
      if (run.meta === null) applyMeta(run, info.meta);
      run.currentPhase = text(title, 128);
      if (!run.seenPhases.includes(run.currentPhase)) run.seenPhases.push(run.currentPhase);
      pushLog(run, 'phase', `▸ ${run.currentPhase}`);
      touch(run);
    },

    /** Engine `workflow/log`. */
    log(info, message) {
      if (!info || typeof info.id !== 'string') return;
      const run = ensure(info.id);
      pushLog(run, 'log', String(message ?? ''));
      touch(run);
    },

    /** Engine `workflow/agent-start` or session `tool-workflow/agent-start`. */
    agentStart(runId, agent) {
      if (typeof runId !== 'string' || !agent) return;
      const run = ensure(runId);
      const before = run.nodes.length;
      const node = upsertNode(run, agent);
      if (node === null) return;
      if (run.nodes.length !== before) pushLog(run, 'agent', `#${node.seq} ${node.label} started`);
      touch(run);
    },

    /** Engine `workflow/agent-end` or session `tool-workflow/agent-end`. */
    agentEnd(runId, agent) {
      if (typeof runId !== 'string' || !agent) return;
      const run = ensure(runId);
      const node = upsertNode(run, agent);
      if (node === null) return;
      const status = NODE_STATUS.includes(agent.outcome) ? agent.outcome : 'failed';
      if (node.status === status && node.endedAt !== null) return;
      node.status = status;
      node.endedAt = now();
      pushLog(run, 'agent', `#${node.seq} ${node.label} ${status}`);
      touch(run);
    },

    /** Engine `workflow/end` or session `tool-workflow/run-end`. */
    runEnd(runId, result) {
      if (typeof runId !== 'string') return;
      const run = ensure(runId);
      const reason = result?.stopReason ?? 'completed';
      const already = run.status !== 'running';
      run.stopReason = reason;
      run.status = stopToStatus(reason);
      if (typeof result?.error === 'string') run.error = text(result.error, 2000);
      if (Number.isSafeInteger(result?.agentsStarted)) run.agentsStarted = result.agentsStarted;
      if (run.endedAt === null) run.endedAt = now();
      for (const node of run.nodes) {
        if (node.status === 'running') {
          node.status = run.status === 'completed' ? 'completed' : 'cancelled';
          node.endedAt = run.endedAt;
        }
      }
      if (!already) pushLog(run, 'end', `■ ${reason}${run.error ? `: ${run.error}` : ''}`);
      run.currentPhase = null;
      touch(run);
    },

    /** Session `tool-workflow/run-start`: binds the run to its owning session. */
    sessionRunStart(sessionId, data) {
      if (typeof sessionId !== 'string' || !data || typeof data.runId !== 'string') return;
      const run = ensure(data.runId);
      run.sessionId = sessionId;
      if (run.name === '' && typeof data.name === 'string') run.name = text(data.name, 200);
      inheritSessionModel(run);
      claimCall(run);
      touch(run);
    },

    /** Session `tool/call` named `workflow`: keeps the script for display and re-saving. */
    toolCall(sessionId, callId, argumentsJson) {
      if (typeof sessionId !== 'string') return;
      let args;
      try { args = JSON.parse(argumentsJson); } catch { return; }
      if (!args || typeof args.script !== 'string') return;
      const queue = pendingCalls.get(sessionId) ?? [];
      queue.push({
        callId: typeof callId === 'string' ? callId : null,
        name: typeof args.meta?.name === 'string' ? args.meta.name : '',
        meta: args.meta ?? null,
        script: args.script.slice(0, MAX_SCRIPT),
        args: args.args ?? null,
        background: args.run_in_background === true,
      });
      if (queue.length > 16) queue.shift();
      pendingCalls.set(sessionId, queue);
      // The run may already exist when the engine event raced ahead.
      for (const run of runs.values()) {
        if (run.sessionId === sessionId && run.script === '') {
          claimCall(run);
          touch(run);
        }
      }
    },

    /** A child session reported its model (selection or first assistant message). */
    childModel(childId, provider, model) {
      if (typeof childId !== 'string' || typeof model !== 'string' || model === '') return false;
      const cleanModel = text(model, 120);
      const cleanProvider = typeof provider === 'string' ? text(provider, 120) : null;
      sessionModels.set(childId, { provider: cleanProvider, model: cleanModel });
      const ref = childIndex.get(childId);
      if (ref === undefined) return false;
      const run = runs.get(ref.runId);
      const node = run?.nodes.find((candidate) => candidate.seq === ref.seq);
      if (!node || (node.model === cleanModel && node.provider === cleanProvider)) return false;
      node.model = cleanModel;
      node.provider = cleanProvider;
      touch(run);
      return true;
    },

    /** Any session (parent or child) reported its model selection or active LLM route. */
    sessionModel(sessionId, provider, model) {
      if (typeof sessionId !== 'string' || typeof model !== 'string' || model === '') return false;
      const cleanModel = text(model, 120);
      const cleanProvider = typeof provider === 'string' ? text(provider, 120) : null;
      sessionModels.set(sessionId, { provider: cleanProvider, model: cleanModel });
      let changed = api.childModel(sessionId, cleanProvider, cleanModel);
      for (const run of runs.values()) {
        if (run.sessionId === sessionId && run.status === 'running') {
          if (run.sessionModel !== cleanModel || run.sessionProvider !== cleanProvider) {
            run.sessionModel = cleanModel;
            run.sessionProvider = cleanProvider;
            touch(run);
            changed = true;
          }
        }
      }
      return changed;
    },

    /** The newest run of a session, raw, or undefined. */
    latest(sessionId) {
      let best;
      for (const run of runs.values()) {
        if (run.sessionId !== sessionId) continue;
        if (best === undefined || run.startedAt > best.startedAt) best = run;
      }
      return best;
    },

    list(filter = {}) {
      const all = [...runs.values()]
        .filter((run) => (filter.sessionId ? run.sessionId === filter.sessionId : true))
        .sort((a, b) => b.startedAt - a.startedAt);
      return { rev, runs: all.map(summaryOf) };
    },

    get(runId) {
      const run = runs.get(runId);
      return run === undefined ? null : detailOf(run);
    },

    raw(runId) {
      return runs.get(runId);
    },

    async remove(runId) {
      const run = runs.get(runId);
      if (run === undefined) return false;
      if (run.status === 'running') throw new Error('cannot delete a running workflow');
      runs.delete(runId);
      rev += 1;
      if (dir !== null) await rm(path.join(dir, `${runId}.json`), { force: true });
      return true;
    },

    /** Load persisted runs; anything still `running` belonged to a dead process. */
    async load() {
      if (dir === null) return 0;
      let names = [];
      try { names = await readdir(dir); } catch { return 0; }
      let loaded = 0;
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          const run = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
          if (!run || typeof run.id !== 'string' || runs.has(run.id)) continue;
          const merged = { ...freshRun(run.id, run.startedAt ?? now()), ...run };
          if (merged.status === 'running') {
            merged.status = 'interrupted';
            merged.endedAt = merged.endedAt ?? now();
            for (const node of merged.nodes) if (node.status === 'running') node.status = 'interrupted';
            schedulePersist(merged);
          }
          rev += 1;
          merged.rev = rev;
          runs.set(merged.id, merged);
          for (const node of merged.nodes) if (typeof node.childId === 'string') childIndex.set(node.childId, { runId: merged.id, seq: node.seq });
          loaded += 1;
        } catch (error) {
          warn(`dynamic-workflow: skipped unreadable run file ${name}: ${error?.message ?? error}`);
        }
      }
      await prune();
      return loaded;
    },

    /** Flush pending writes; used on dispose and in tests. */
    async flush() {
      const pending = [...timers.keys()];
      for (const id of pending) {
        clearTimeout(timers.get(id));
        timers.delete(id);
        const run = runs.get(id);
        if (run) await writeRun(run);
      }
    },

    async close() {
      await api.flush();
      closed = true;
    },
  };
  return api;
}
