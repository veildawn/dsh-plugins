/**
 * dsh-repo-wiki — `wiki_plan.yaml` parsing and validation.
 *
 * Qoder reads this file with a real YAML parser, but the schema it accepts is
 * tiny and fixed: block mappings, block sequences, plain/quoted scalars, inline
 * empty collections, and comments. Rather than take a YAML dependency for that
 * (and inherit its anchor/merge/tag surface, which would let a repository
 * escalate into parser bugs), this module implements exactly that subset. The
 * parser is a pure function of the text, which is what lets the round-trip
 * property be tested exhaustively.
 *
 * Anything outside the subset — anchors, aliases, tags, flow mappings,
 * multi-document streams — is rejected with a located error instead of being
 * guessed at.
 *
 * Schema validation follows Qoder's own posture, verified in
 * `qoder-search.bundle.mjs` (`rEe`, `cjr`, `ujr`, `ljr`): every recoverable
 * problem produces a warning and is normalized (dropped, truncated,
 * re-parented, or coerced) rather than rejected. The file is refused outright
 * only when it is too large, is not valid YAML, or its top level is not a
 * mapping — Qoder's three `rejection` codes.
 *
 * @module dsh-repo-wiki/plan
 */

import { LAYOUT, STATUS } from './constants.js';

/** Templates Qoder documents. */
export const TEMPLATES = Object.freeze(['architecture', 'product_requirement']);

/**
 * Qoder's published limits for this file.
 *
 * Taken from the plan validator in `qoder-search.bundle.mjs` (`H0e`, `uD`, `bG`,
 * `V0e`, `K0e`, `B0e`, `W0e`). Enforcing the same numbers means a file that Qoder
 * accepts is accepted here, and one it rejects is rejected with a comparable
 * message instead of being silently truncated at write time.
 */
export const PLAN_LIMITS = Object.freeze({
  /** Whole file, bytes. */
  bytes: 2 * 1024 * 1024,
  /** `repowiki.documents` entries. */
  documents: 500,
  /** `notes` entries, per section. */
  notes: 50,
  /** Document title characters. */
  titleChars: 100,
  /** Document goal characters. */
  goalChars: 10000,
  /** Document hints characters. */
  hintsChars: 5000,
  /** Document template characters. */
  templateChars: 5000,
  /** Note author characters. */
  authorChars: 100,
  /** Note text characters. */
  noteChars: 10000,
  /**
   * Nesting depth under a top-level document. Qoder allows one level of
   * children; deeper documents are re-parented with a diagnostic.
   */
  childLevels: 1,
});

/** Fields the file may contain at the top level. */
const TOP_KEYS = Object.freeze(['version', 'repowiki', 'knowledgecard', 'scope']);
const REPOWIKI_KEYS = Object.freeze(['template', 'notes', 'documents']);
const KNOWLEDGECARD_KEYS = Object.freeze(['notes']);
const SCOPE_KEYS = Object.freeze(['include', 'exclude']);
const NOTE_KEYS = Object.freeze(['text', 'author']);
const DOCUMENT_KEYS = Object.freeze(['title', 'goal', 'parent', 'hints', 'template']);

/** A plan error carrying the line that caused it. */
export class PlanError extends Error {
  /**
   * @param {string} message
   * @param {number} [line] 1-based line number, 0 when unknown
   */
  constructor(message, line = 0) {
    super(line > 0 ? `${message} (line ${line})` : message);
    this.name = 'PlanError';
    this.line = line;
  }
}

/* ------------------------------------------------------------------------- *
 * Parser
 * ------------------------------------------------------------------------- */

/** Split a line into its content and an optional inline comment. */
function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== '') {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Resolve a plain scalar to its typed value. */
function parseScalar(raw, line) {
  const text = raw.trim();
  if (text === '') return null;
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/u.test(text)) {
    const value = Number.parseInt(text, 10);
    if (Number.isSafeInteger(value)) return value;
  }
  if (/^-?\d+\.\d+$/u.test(text)) return Number.parseFloat(text);
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new PlanError('unterminated double-quoted scalar', line);
    try {
      return JSON.parse(text);
    } catch {
      throw new PlanError('invalid escape sequence in double-quoted scalar', line);
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new PlanError('unterminated single-quoted scalar', line);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text.startsWith('"') || text.startsWith("'")) throw new PlanError('malformed quoted scalar', line);
  if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) {
    throw new PlanError('anchors, aliases and tags are not supported', line);
  }
  // Block scalars are supported because Qoder's own documented schema uses one
  // for a document's `template`. The body is collected by the parser, not here.
  if (text === '|' || text === '>' || /^[|>][+-]?\d*$/u.test(text)) {
    return { __blockScalar: text };
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    throw new PlanError('flow collections are not supported', line);
  }
  return text;
}

/**
 * One significant line: indentation, and either `key: value` or `- value`.
 *
 * A malformed line is recorded rather than thrown, so the document is parsed in
 * source order and the *first* real problem is the one reported. Classifying
 * eagerly while throwing would let a later broken line mask an earlier, more
 * specific error (e.g. a block scalar on line 1).
 */
function classify(rawLine, lineNumber, rawIndex = -1) {
  const expanded = rawLine.replaceAll('\t', '  ');
  const content = stripComment(expanded).replace(/\s+$/u, '');
  if (content.trim() === '') return null;
  const indent = content.length - content.trimStart().length;
  const body = content.slice(indent);
  const broken = (message) => ({ indent, kind: 'error', message, line: lineNumber, rawIndex });
  if (body === '---' || body === '...') return broken('multi-document streams are not supported');
  const sequence = body === '-' || body.startsWith('- ');
  if (sequence) {
    return { indent, kind: 'sequence', value: body === '-' ? '' : body.slice(2).trim(), line: lineNumber, rawIndex };
  }
  const colon = findKeyColon(body);
  if (colon < 0) return broken('expected "key: value" or "- value"');
  const key = body.slice(0, colon).trim();
  if (key === '') return broken('empty mapping key');
  return { indent, kind: 'mapping', key, value: body.slice(colon + 1).trim(), line: lineNumber, rawIndex };
}

/** Index of the `:` separating a key from its value, ignoring quoted keys. */
function findKeyColon(body) {
  if (body.startsWith('"')) {
    const end = body.indexOf('"', 1);
    if (end < 0) return -1;
    const rest = body.slice(end + 1);
    return rest.startsWith(':') ? end + 1 : -1;
  }
  if (body.startsWith("'")) {
    const end = body.indexOf("'", 1);
    if (end < 0) return -1;
    const rest = body.slice(end + 1);
    return rest.startsWith(':') ? end + 1 : -1;
  }
  const at = body.indexOf(':');
  if (at < 0) return -1;
  // A colon only separates when followed by whitespace or end-of-line, so
  // `title: 系统: 架构` keeps its value intact and `a:b` stays a plain scalar.
  const after = body.slice(at + 1);
  if (after !== '' && !after.startsWith(' ') && !after.startsWith('\t')) return -1;
  return at;
}

/**
 * Parse the supported YAML subset.
 *
 * @param {string} text
 * @returns {unknown} the parsed document (`null` for an empty document)
 * @throws {PlanError} on anything outside the subset
 */
export function parseYaml(text) {
  if (typeof text !== 'string') throw new PlanError('plan source must be a string');
  if (Buffer.byteLength(text, 'utf8') > PLAN_LIMITS.bytes) {
    throw new PlanError(`plan file exceeds ${PLAN_LIMITS.bytes} bytes`);
  }
  const raw = text.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u);
  const lines = [];
  for (let i = 0; i < raw.length; i += 1) {
    const classified = classify(raw[i], i + 1, i);
    if (classified !== null) lines.push(classified);
  }
  if (lines.length === 0) return null;

  const state = { lines, raw, index: 0 };

  /**
   * Parse a node whose children are indented deeper than `parentIndent`.
   * @param {number} parentIndent
   * @returns {unknown}
   */
  function parseNode(parentIndent) {
    const first = state.lines[state.index];
    if (first === undefined || first.indent <= parentIndent) return null;
    if (first.kind === 'error') throw new PlanError(first.message, first.line);
    if (first.kind === 'sequence') return parseSequence(first.indent);
    return parseMapping(first.indent);
  }

  function parseSequence(indent) {
    const out = [];
    while (state.index < state.lines.length) {
      const line = state.lines[state.index];
      if (line.indent !== indent) break;
      if (line.kind === 'error') throw new PlanError(line.message, line.line);
      if (line.kind !== 'sequence') break;
      state.index += 1;
      if (line.value === '') {
        out.push(parseNode(indent));
        continue;
      }
      // `- key: value` opens an inline mapping whose remaining keys are indented
      // two spaces past the dash; splice a synthetic first line back in.
      // A plain scalar that merely contains a colon (`- src/app.ts`) is not a
      // mapping, so the probe must not throw.
      const inline = classify(`${' '.repeat(indent + 2)}${line.value}`, line.line);
      if (inline !== null && inline.kind === 'mapping') {
        state.lines.splice(state.index, 0, inline);
        out.push(parseMapping(indent + 2));
        continue;
      }
      out.push(parseScalar(line.value, line.line));
    }
    return out;
  }

  function parseMapping(indent) {
    const out = {};
    while (state.index < state.lines.length) {
      const line = state.lines[state.index];
      if (line.indent !== indent) break;
      if (line.kind === 'error') throw new PlanError(line.message, line.line);
      if (line.kind !== 'mapping') break;
      state.index += 1;
      if (Object.hasOwn(out, line.key)) {
        throw new PlanError(`duplicate key "${line.key}"`, line.line);
      }
      if (line.value !== '') {
        const scalar = parseScalar(line.value, line.line);
        if (scalar !== null && typeof scalar === 'object' && scalar.__blockScalar !== undefined) {
          out[line.key] = readBlockScalar(scalar.__blockScalar, indent, line.rawIndex);
          continue;
        }
        out[line.key] = scalar;
        continue;
      }
      const next = state.lines[state.index];
      // A bare `key:` followed by a sibling at the same or lower indent is a
      // null value, not an empty container.
      if (next === undefined || next.indent <= indent) {
        out[line.key] = null;
        continue;
      }
      out[line.key] = next.kind === 'sequence' ? parseSequence(next.indent) : parseMapping(next.indent);
    }
    return out;
  }

  /**
   * Read a `|` / `>` block scalar body: every following line indented deeper
   * than the owning key. `|` keeps newlines, `>` folds them. A chomping
   * indicator (`-` strip, `+` keep) is honoured; the default clips trailing
   * blank lines to one newline.
   * @param {string} indicator the raw `|`, `|-`, `>`, `>+` … token
   * @param {number} ownerIndent indentation of the owning mapping key
   * @param {number} ownerLine line number of the owning key
   * @returns {string}
   */
  function readBlockScalar(indicator, ownerIndent, ownerRawIndex) {
    const literal = indicator.startsWith('|');
    const chomp = indicator.includes('-') ? 'strip' : indicator.includes('+') ? 'keep' : 'clip';
    const body = [];
    let blockIndent = -1;
    let cursor = ownerRawIndex + 1;
    for (; cursor < state.raw.length; cursor += 1) {
      const source = state.raw[cursor].replaceAll('\t', '  ');
      if (source.trim() === '') {
        body.push('');
        continue;
      }
      const indent = source.length - source.trimStart().length;
      if (indent <= ownerIndent) break;
      if (blockIndent < 0) blockIndent = indent;
      body.push(source.slice(Math.min(blockIndent, indent)));
    }
    // Advance the classified-line cursor past everything the block consumed.
    while (state.index < state.lines.length && state.lines[state.index].rawIndex < cursor) state.index += 1;
    // Trailing blank lines belong to the block only when chomping keeps them.
    while (body.length > 0 && body[body.length - 1] === '' && chomp !== 'keep') body.pop();
    if (body.length === 0) return '';
    let out;
    if (literal) {
      out = body.join('\n');
    } else {
      out = body.reduce((acc, current) => {
        if (current === '') return `${acc}\n`;
        if (acc === '' || acc.endsWith('\n')) return acc + current;
        return `${acc} ${current}`;
      }, '');
    }
    if (chomp === 'strip') return out.replace(/\n+$/u, '');
    return `${out.replace(/\n+$/u, '')}\n`;
  }

  const document = parseNode(-1);
  if (state.index < state.lines.length) {
    const leftover = state.lines[state.index];
    throw new PlanError(leftover.kind === 'error' ? leftover.message : 'unexpected indentation', leftover.line);
  }
  return document;
}

/* ------------------------------------------------------------------------- *
 * Validation (Qoder's warn-and-normalize posture)
 * ------------------------------------------------------------------------- */

/** The version Qoder accepts without comment (`cD` in the search bundle). */
const SUPPORTED_VERSION = 1;

function warnKeys(object, allowed, where, warn) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) warn(`${where}.${key} is not a recognized key, ignored`);
  }
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Qoder's `Fg`: coerce a scalar to text, warning about what had to change. */
function coerceScalar(value, where, warn) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    warn(`${where} is not a string, coerced to text`);
    return String(value);
  }
  warn(`${where} is not a string, ignored`);
  return '';
}

/** Qoder's `x_t`: coerce to a list, warning when it was not one. */
function coerceList(value, where, warn) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  warn(`${where} is not a list, ignored`);
  return [];
}

/** Qoder's `eEe`: coerce to a mapping, checking its keys, warning otherwise. */
function coerceMapping(value, where, allowedKeys, warn) {
  if (value === null || value === undefined) return {};
  if (!isMapping(value)) {
    warn(`${where} is not a mapping, ignored`);
    return {};
  }
  warnKeys(value, allowedKeys, where, warn);
  return value;
}

/** Clip a value at `limit`, warning when it had to be truncated. */
function clipped(value, limit, where, warn) {
  if (value.length <= limit) return value;
  warn(`${where} exceeds ${limit} characters, truncated`);
  return value.slice(0, limit);
}

/** Qoder's `k_t`: notes as `{text, author}` rows, normalized with warnings. */
function normalizeNotes(value, where, warn) {
  const raw = coerceList(value, where, warn);
  const notes = [];
  for (const [index, entry] of raw.entries()) {
    const at = `${where}[${index}]`;
    if (!isMapping(entry)) {
      warn(`${at} is not a mapping, dropped`);
      continue;
    }
    warnKeys(entry, NOTE_KEYS, at, warn);
    const text = clipped(coerceScalar(entry.text, `${at}.text`, warn), PLAN_LIMITS.noteChars, `${at}.text`, warn).trim();
    if (text === '') {
      warn(`${at}.text is empty, dropped`);
      continue;
    }
    const author = clipped(coerceScalar(entry.author, `${at}.author`, warn), PLAN_LIMITS.authorChars, `${at}.author`, warn).trim();
    notes.push({ text, author });
  }
  if (notes.length > PLAN_LIMITS.notes) {
    warn(`${where} has ${notes.length} entries, truncated to ${PLAN_LIMITS.notes}`);
    notes.length = PLAN_LIMITS.notes;
  }
  return notes;
}

/**
 * Qoder's `cjr` + `ujr` + `ljr`: document rows normalized with warnings.
 *
 * A document needs both a title and a goal to survive — a goal-less entry is
 * dropped because the writer would have no brief. Duplicate titles keep the
 * first, unknown/self parents promote to the top level, cyclic chains break at
 * the loop, and nesting deeper than one level is re-parented to the top.
 */
function normalizeDocuments(value, where, warn) {
  const raw = coerceList(value, where, warn);
  const documents = [];
  const seen = new Set();
  for (const [index, entry] of raw.entries()) {
    const at = `${where}[${index}]`;
    if (!isMapping(entry)) {
      warn(`${at} is not a mapping, dropped`);
      continue;
    }
    warnKeys(entry, DOCUMENT_KEYS, at, warn);
    const title = clipped(coerceScalar(entry.title, `${at}.title`, warn), PLAN_LIMITS.titleChars, `${at}.title`, warn).trim();
    if (title === '') {
      warn(`${at}.title is empty, dropped`);
      continue;
    }
    if (seen.has(title)) {
      warn(`${at} ("${title}") duplicates an earlier title, dropped`);
      continue;
    }
    const goal = clipped(coerceScalar(entry.goal, `${at}.goal`, warn), PLAN_LIMITS.goalChars, `${at} ("${title}") goal`, warn).trim();
    if (goal === '') {
      warn(`${at} ("${title}") goal is empty, dropped`);
      continue;
    }
    const hints = clipped(coerceScalar(entry.hints, `${at}.hints`, warn), PLAN_LIMITS.hintsChars, `${at} ("${title}") hints`, warn).trim();
    const template = clipped(coerceScalar(entry.template, `${at}.template`, warn), PLAN_LIMITS.templateChars, `${at} ("${title}") template`, warn);
    seen.add(title);
    documents.push({
      title,
      goal,
      parent: coerceScalar(entry.parent, `${at}.parent`, warn).trim(),
      hints,
      template,
    });
  }
  if (documents.length > PLAN_LIMITS.documents) {
    warn(`${where} has ${documents.length} entries, truncated to ${PLAN_LIMITS.documents}`);
    documents.length = PLAN_LIMITS.documents;
  }
  // Unknown and self parents promote to the top level rather than orphaning the
  // document.
  for (const document of documents) {
    if (document.parent === '') continue;
    if (document.parent === document.title) {
      warn(`${where}: "${document.title}" names itself as parent, promoted to top level`);
      document.parent = '';
      continue;
    }
    if (!seen.has(document.parent)) {
      warn(`${where}: "${document.title}" names unknown parent "${document.parent}", promoted to top level`);
      document.parent = '';
    }
  }
  // Cyclic chains cannot be placed anywhere; break them at the document that
  // closes the loop.
  const byTitle = new Map(documents.map((document) => [document.title, document]));
  for (const document of documents) {
    const visited = new Set([document.title]);
    let cursor = document.parent;
    while (cursor !== '') {
      if (visited.has(cursor)) {
        warn(`${where}: parent chain starting at "${document.title}" is cyclic, promoted to top level`);
        document.parent = '';
        break;
      }
      visited.add(cursor);
      cursor = byTitle.get(cursor)?.parent ?? '';
    }
  }
  // Qoder allows one level of nesting: a deeper document keeps its title and
  // goal but is re-parented to the top level with a warning.
  for (const document of documents) {
    if (document.parent === '') continue;
    const parent = byTitle.get(document.parent);
    if (parent !== undefined && parent.parent !== '') {
      warn(`${where}: "${document.title}" is nested deeper than one level, re-parented to top level`);
      document.parent = '';
      document.reparented = true;
    }
  }
  return documents;
}

/** Normalize a `.gitignore`-style pattern list. */
function normalizePatterns(value, where, warn) {
  return coerceList(value, where, warn)
    .map((entry, index) => coerceScalar(entry, `${where}[${index}]`, warn).trim())
    .filter((entry) => entry !== '');
}

function emptyPlan() {
  return {
    version: SUPPORTED_VERSION,
    repowiki: { template: '', notes: [], documents: [] },
    knowledgecard: { notes: [] },
    scope: { include: [], exclude: [] },
  };
}

/**
 * Validate and normalize a parsed plan, the way Qoder's `rEe` does.
 *
 * Every recoverable problem becomes a diagnostic and is normalized away — an
 * unrecognized key is ignored, a wrong type is coerced or dropped, an overlong
 * value is truncated, an out-of-range list is clipped. Only a top level that is
 * not a mapping refuses the file outright (`rejection: 'not_a_mapping'`).
 *
 * @param {unknown} document the parsed YAML value
 * @returns {{ plan: object, diagnostics: string[], rejection: string|null }}
 */
export function validatePlan(document) {
  const diagnostics = [];
  const warn = (message) => diagnostics.push(message);
  if (document === null || document === undefined) {
    return { plan: emptyPlan(), diagnostics, rejection: null };
  }
  if (!isMapping(document)) {
    diagnostics.push('wiki_plan.yaml top level is not a mapping, ignored');
    return { plan: emptyPlan(), diagnostics, rejection: 'not_a_mapping' };
  }
  warnKeys(document, TOP_KEYS, 'wiki_plan.yaml', warn);

  let version = SUPPORTED_VERSION;
  if (document.version !== undefined) {
    if (typeof document.version !== 'number') {
      warn(`version is not a number, treated as version ${SUPPORTED_VERSION}`);
    } else if (document.version !== 0 && document.version !== SUPPORTED_VERSION) {
      warn(`version ${document.version} is not supported (only ${SUPPORTED_VERSION}), continuing as version ${SUPPORTED_VERSION}`);
    } else {
      version = document.version;
    }
  }

  const scopeSource = coerceMapping(document.scope, 'scope', SCOPE_KEYS, warn);
  const repowiki = coerceMapping(document.repowiki, 'repowiki', REPOWIKI_KEYS, warn);
  const knowledgecard = coerceMapping(document.knowledgecard, 'knowledgecard', KNOWLEDGECARD_KEYS, warn);

  let template = coerceScalar(repowiki.template, 'repowiki.template', warn).trim();
  if (template !== '' && !TEMPLATES.includes(template)) {
    warn(`repowiki.template "${template}" is not a recognized preset name, ignored`);
    template = '';
  }

  return {
    plan: {
      version,
      repowiki: {
        template,
        notes: normalizeNotes(repowiki.notes, 'repowiki.notes', warn),
        documents: normalizeDocuments(repowiki.documents, 'repowiki.documents', warn),
      },
      knowledgecard: { notes: normalizeNotes(knowledgecard.notes, 'knowledgecard.notes', warn) },
      // `scope` is a DSH extension: Qoder warns and ignores it, we honour it.
      scope: {
        include: normalizePatterns(scopeSource.include, 'scope.include', warn),
        exclude: normalizePatterns(scopeSource.exclude, 'scope.exclude', warn),
      },
    },
    diagnostics,
    rejection: null,
  };
}

/**
 * Parse + validate in one step, never throwing.
 *
 * Qoder refuses the file only for `too_large`, `syntax_error`, and
 * `not_a_mapping`; everything else is a warning attached to a usable plan.
 * `valid` is therefore `false` exactly when `rejection` is set.
 * @param {string} text raw file contents
 * @param {string} [configPath] path echoed back to the caller
 * @returns {{ valid: boolean, plan: object|null, errorMessage: string, configPath: string, diagnostics: string[], rejection: string|null }}
 */
export function parsePlan(text, configPath = '') {
  const fail = (message, rejection) => ({
    valid: false,
    plan: null,
    errorMessage: message,
    configPath,
    diagnostics: [message],
    rejection,
  });
  if (typeof text !== 'string') return fail('plan source must be a string', 'syntax_error');
  if (text.trim() === '') {
    return { valid: true, plan: emptyPlan(), errorMessage: '', configPath, diagnostics: [], rejection: null };
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > PLAN_LIMITS.bytes) {
    return fail(`wiki_plan.yaml is ${bytes} bytes, above the ${PLAN_LIMITS.bytes} byte limit; ignored`, 'too_large');
  }
  let document;
  try {
    document = parseYaml(text);
  } catch (error) {
    const message = error instanceof PlanError ? error.message : `unexpected error: ${String(error)}`;
    return fail(`wiki_plan.yaml is not valid YAML, ignored: ${message}`, 'syntax_error');
  }
  const { plan, diagnostics, rejection } = validatePlan(document);
  if (rejection !== null) {
    return { valid: false, plan: null, errorMessage: diagnostics[0] ?? '', configPath, diagnostics, rejection };
  }
  return { valid: true, plan, errorMessage: '', configPath, diagnostics, rejection: null };
}

/** Whether a plan constrains the generated page list. */
export function hasDocumentWhitelist(plan) {
  return Array.isArray(plan?.repowiki?.documents) && plan.repowiki.documents.length > 0;
}

/** Whether a plan constrains the analysed file set. */
export function hasScope(plan) {
  return (plan?.scope?.include?.length ?? 0) > 0 || (plan?.scope?.exclude?.length ?? 0) > 0;
}

/* ------------------------------------------------------------------------- *
 * Rendering
 * ------------------------------------------------------------------------- */

/** Quote a scalar for YAML output when it would otherwise be ambiguous. */
function quoteScalar(value) {
  const text = String(value);
  if (text === '') return '""';
  const needsQuotes =
    /^[\s#\-?:,[\]{}&*!|>'"%@`]/u.test(text) ||
    /\s$/u.test(text) ||
    /: /u.test(text) ||
    text === 'null' ||
    text === 'true' ||
    text === 'false' ||
    /^-?\d/u.test(text);
  if (!needsQuotes) return text;
  return JSON.stringify(text);
}

/**
 * Render a normalized plan back to YAML.
 *
 * `parsePlan(renderPlanYaml(p)).plan` deep-equals `p` for every valid `p` — the
 * round-trip property this module is tested against.
 * @param {object} plan a value returned by {@link validatePlan}
 * @returns {string}
 */
export function renderPlanYaml(plan) {
  const out = [`version: ${plan.version}`];

  const repowiki = plan.repowiki ?? { template: '', notes: [], documents: [] };
  out.push('', 'repowiki:');
  out.push(`  template: ${repowiki.template === '' ? '""' : quoteScalar(repowiki.template)}`);
  if (repowiki.notes.length === 0) {
    out.push('  notes: []');
  } else {
    out.push('  notes:');
    for (const note of repowiki.notes) {
      out.push(`    - text: ${quoteScalar(note.text)}`);
      if (note.author !== '') out.push(`      author: ${quoteScalar(note.author)}`);
    }
  }
  if (repowiki.documents.length === 0) {
    out.push('  documents: []');
  } else {
    out.push('  documents:');
    for (const document of repowiki.documents) {
      out.push(`    - title: ${quoteScalar(document.title)}`);
      if (document.goal !== '') out.push(`      goal: ${quoteScalar(document.goal)}`);
      if (document.parent !== '') out.push(`      parent: ${quoteScalar(document.parent)}`);
      if (document.hints !== '') out.push(`      hints: ${quoteScalar(document.hints)}`);
      if (document.template !== undefined && document.template !== '') {
        out.push(`      template: ${quoteScalar(document.template)}`);
      }
    }
  }

  const notes = plan.knowledgecard?.notes ?? [];
  out.push('', 'knowledgecard:');
  if (notes.length === 0) {
    out.push('  notes: []');
  } else {
    out.push('  notes:');
    for (const note of notes) {
      out.push(`    - text: ${quoteScalar(note.text)}`);
      if (note.author !== '') out.push(`      author: ${quoteScalar(note.author)}`);
    }
  }

  out.push('', 'scope:');
  out.push(renderPatternField('include', plan.scope?.include ?? []));
  out.push(renderPatternField('exclude', plan.scope?.exclude ?? []));
  return `${out.join('\n')}\n`;
}

function renderPatternField(key, patterns) {
  if (patterns.length === 0) return `  ${key}: []`;
  return [`  ${key}:`, ...patterns.map((pattern) => `    - ${quoteScalar(pattern)}`)].join('\n');
}

/** A starter plan the panel can write on demand. */
export function emptyPlanYaml() {
  return renderPlanYaml(validatePlan(null).plan);
}

/* ------------------------------------------------------------------------- *
 * Prompt rendering
 * ------------------------------------------------------------------------- */

/**
 * Render the constraint block injected into the planning and writing prompts.
 *
 * Returns an empty string when the plan constrains nothing, so the caller can
 * concatenate unconditionally.
 * @param {object|null} plan
 * @returns {string}
 */
export function renderPlanPrompt(plan) {
  if (plan === null || plan === undefined) return '';
  const sections = [];

  // Qoder's built-in presets inject their own note before the author's; the
  // wording is its own (G0e in the search bundle).
  const template = plan.repowiki?.template ?? '';
  if (template === 'architecture') {
    sections.push(
      'Template: **architecture**. Comprehensively analyse structure, components, and tech stack. Cover, in this order: overall architecture, module boundaries, data flow, deployment/topology, and troubleshooting.',
    );
  } else if (template === 'product_requirement') {
    sections.push(
      'Template: **product_requirement**. Take the product view: emphasise business flows and play down implementation detail. Use exactly these sections:',
    );
    sections.push(
      [
        '  ## 产品概述',
        '  ## 核心业务流程',
        '  ## 功能模块清单',
        '  ## 数据与状态',
        '  ## 关键约束与边界',
      ].join('\n'),
    );
  }

  const notes = plan.repowiki?.notes ?? [];
  if (notes.length > 0) {
    sections.push('Author guidelines — treat these as **strong priors** for article boundaries, titles and objectives:');
    for (const note of notes) {
      sections.push(`- ${note.text}${note.author === '' ? '' : ` — ${note.author}`}`);
    }
  }

  const documents = plan.repowiki?.documents ?? [];
  if (documents.length > 0) {
    sections.push(
      `The page list is a **strict whitelist** from ${LAYOUT.planFile}. Emit exactly these ${documents.length} page(s), preserving every title string verbatim and the parent-child relationship, and add none:`,
    );
    for (const document of documents) {
      const parent = document.parent === '' ? '' : ` (child of "${document.parent}")`;
      const goal = document.goal === '' ? '' : ` — ${document.goal}`;
      const hints = document.hints === '' ? '' : ` [hints: ${document.hints}]`;
      sections.push(`- ${document.title}${parent}${goal}${hints}`);
      if (typeof document.template === 'string' && document.template.trim() !== '') {
        sections.push(`  required outline:\n${document.template.trim().split('\n').map((line) => `    ${line}`).join('\n')}`);
      }
    }
  }

  const cardNotes = plan.knowledgecard?.notes ?? [];
  if (cardNotes.length > 0) {
    sections.push('Knowledge-card notes from the team:');
    for (const note of cardNotes) sections.push(`- ${note.text}`);
  }

  const include = plan.scope?.include ?? [];
  const exclude = plan.scope?.exclude ?? [];
  if (include.length > 0 || exclude.length > 0) {
    sections.push(`File scope from ${LAYOUT.planFile}:`);
    if (include.length > 0) sections.push(`- include only: ${include.map((p) => `\`${p}\``).join(', ')}`);
    if (exclude.length > 0) sections.push(`- exclude: ${exclude.map((p) => `\`${p}\``).join(', ')}`);
  }

  if (sections.length === 0) return '';
  return ['## Wiki plan constraints', '', ...sections].join('\n');
}

/** Status string used when a plan file is present but invalid. */
export const PLAN_INVALID_STATUS = STATUS.WIKI_INIT;
