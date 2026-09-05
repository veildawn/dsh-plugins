/**
 * Prompt History Navigator - Pure Core Logic
 *
 * Manages per-session prompt history stacks, cursor navigation positions,
 * host persistence paths, and cross-terminal synchronization.
 */

import path from 'node:path';
import os from 'node:os';

export const DEFAULT_MAX_HISTORY = 200;
export const MAX_PROMPT_CHARS = 8192;
export const GLOBAL_SESSION_ID = '__global__';
export const STORAGE_KEY_PREFIX = 'dsh:prompt_history_v2:';
export const RPC_CHANNEL = '/dsh-prompt-history';
export const SWIPE_MAX_MS = 400;
export const SWIPE_MIN_PX = 35;
export const SWIPE_VERTICAL_RATIO = 1.5;

/**
 * Convert a sessionId into a safe filename (e.g., session-123.json).
 * @param {string} sessionId
 * @returns {string}
 */
export function sessionFileName(sessionId) {
  const raw = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : GLOBAL_SESSION_ID;
  const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, (c) => '_' + c.charCodeAt(0).toString(16) + '_');
  return `${safe}.json`;
}

/**
 * Resolve the directory where prompt history JSON files are stored on the host.
 * @param {string} [customHome]
 * @returns {string}
 */
export function getPromptHistoryDir(customHome) {
  const dshHome = customHome
    || process.env.DSH_HOME
    || path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'prompt-history');
}

/**
 * Resolve full file path for one session's history.
 * @param {string} sessionId
 * @param {string} [customHome]
 * @returns {string}
 */
export function sessionFilePath(sessionId, customHome) {
  return path.join(getPromptHistoryDir(customHome), sessionFileName(sessionId));
}

/**
 * Check if the caret in a textarea is currently on the first line.
 * @param {string} text
 * @param {number} selectionStart
 * @returns {boolean}
 */
export function isCaretOnFirstLine(text, selectionStart) {
  if (!text || selectionStart <= 0) return true;
  const firstNewline = text.indexOf('\n');
  if (firstNewline === -1) return true;
  return selectionStart <= firstNewline;
}

/**
 * Check if the caret in a textarea is currently on the last line.
 * @param {string} text
 * @param {number} selectionEnd
 * @returns {boolean}
 */
export function isCaretOnLastLine(text, selectionEnd) {
  if (!text || selectionEnd >= text.length) return true;
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) return true;
  return selectionEnd > lastNewline;
}

/**
 * Whether ArrowUp / swipe-up or ArrowDown / swipe-down should drive history.
 * @param {'up' | 'down'} direction
 * @param {{ navigating: boolean, text: string, caretStart: number, caretEnd: number }} ctx
 * @returns {boolean}
 */
export function shouldHandleHistoryGesture(direction, ctx) {
  if (ctx?.navigating) return true;
  if (direction === 'up') return isCaretOnFirstLine(ctx?.text, ctx?.caretStart ?? 0);
  return false;
}

/**
 * Whether a DOM node is the conversation composer surface.
 * @param {Element | null | undefined} el
 * @returns {boolean}
 */
export function isComposerTarget(el) {
  if (!el || typeof el.closest !== 'function') return false;
  const inComposerChrome = el.closest('[data-composer-card]') !== null
    || el.closest('[data-composer-seat]') !== null;
  if (!inComposerChrome) return false;
  if (el.closest('[data-composer-input]') !== null) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || el.closest('textarea') !== null) return true;
  return false;
}

/**
 * True when the @ / / command trigger menu should own ArrowUp/ArrowDown.
 * @param {ParentNode | null | undefined} root
 * @returns {boolean}
 */
export function isTriggerMenuOpen(root) {
  if (!root || typeof root.querySelector !== 'function') return false;
  return !!root.querySelector(
    '[data-trigger-menu], [data-composer-card] [role="listbox"], [data-composer-seat] [role="listbox"]',
  );
}

/**
 * True when `el` is (or is inside) the composer primary send control.
 * @param {Element | null | undefined} el
 * @returns {boolean}
 */
export function isSendButton(el) {
  if (!el || typeof el.closest !== 'function') return false;
  const btn = el.closest('button');
  if (!btn) return false;
  const inComposer = btn.closest('[data-composer-card]') !== null
    || btn.closest('[data-composer-seat]') !== null;
  if (!inComposer) return false;
  const label = btn.getAttribute?.('aria-label') || '';
  return /发送消息|Send message/i.test(label);
}

/**
 * Classify a completed touch as a vertical history swipe.
 * @param {{ deltaX: number, deltaY: number, deltaTime: number }} gesture
 * @returns {'up' | 'down' | null}
 */
export function classifySwipe(gesture) {
  const deltaX = Number(gesture?.deltaX) || 0;
  const deltaY = Number(gesture?.deltaY) || 0;
  const deltaTime = Number(gesture?.deltaTime) || 0;
  if (deltaTime > SWIPE_MAX_MS) return null;
  if (Math.abs(deltaY) < SWIPE_MIN_PX) return null;
  if (Math.abs(deltaY) <= Math.abs(deltaX) * SWIPE_VERTICAL_RATIO) return null;
  return deltaY < 0 ? 'up' : 'down';
}

/**
 * Coerce raw JSON/array into a bounded, deduplicated string list.
 * @param {unknown} raw
 * @param {number} [maxItems]
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function sanitizeHistory(raw, maxItems = DEFAULT_MAX_HISTORY, maxChars = MAX_PROMPT_CHARS) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    let next = item.trim();
    if (!next) continue;
    if (next.length > maxChars) next = next.slice(0, maxChars);
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  if (out.length > maxItems) return out.slice(out.length - maxItems);
  return out;
}

/**
 * Merge local history with remote history while preserving chronological order.
 * @param {string[]} local
 * @param {string[]} remote
 * @param {number} [maxItems]
 * @returns {string[]}
 */
export function mergeHistories(local, remote, maxItems = DEFAULT_MAX_HISTORY) {
  const cleanLocal = sanitizeHistory(local, maxItems);
  const cleanRemote = sanitizeHistory(remote, maxItems);
  const combined = [...cleanRemote];
  for (const item of cleanLocal) {
    if (!combined.includes(item)) {
      combined.push(item);
    }
  }
  if (combined.length > maxItems) {
    return combined.slice(combined.length - maxItems);
  }
  return combined;
}

/**
 * Normalize and push a new prompt to history stack.
 * Duplicates are deduplicated and moved to the most recent end.
 * @param {string[]} history
 * @param {string} prompt
 * @param {number} [maxItems]
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function pushHistory(
  history,
  prompt,
  maxItems = DEFAULT_MAX_HISTORY,
  maxChars = MAX_PROMPT_CHARS,
) {
  const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmed) return Array.isArray(history) ? [...history] : [];

  const next = trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
  const filtered = (Array.isArray(history) ? history : []).filter((item) => item !== next);
  filtered.push(next);

  if (filtered.length > maxItems) {
    filtered.splice(0, filtered.length - maxItems);
  }
  return filtered;
}

/**
 * State machine helper for navigating through prompt history for one session.
 */
export class PromptHistoryState {
  /**
   * @param {string[]} [history]
   * @param {number} [maxItems]
   */
  constructor(history = [], maxItems = DEFAULT_MAX_HISTORY) {
    this.history = Array.isArray(history) ? [...history] : [];
    this.maxItems = maxItems;
    this.index = -1; // -1 means viewing current draft
    this.stashedDraft = '';
  }

  /**
   * Replace current history with updated list while preserving or clamping index.
   * @param {string[]} newHistory
   */
  replaceHistory(newHistory) {
    this.history = sanitizeHistory(newHistory, this.maxItems);
    if (this.index >= this.history.length) {
      this.index = this.history.length - 1;
    }
  }

  reset() {
    this.index = -1;
    this.stashedDraft = '';
  }

  /**
   * Add a prompt to history and reset navigation state.
   * @param {string} prompt
   */
  record(prompt) {
    this.history = pushHistory(this.history, prompt, this.maxItems);
    this.reset();
  }

  navigateUp(currentDraft) {
    if (this.history.length === 0) {
      return { changed: false, text: currentDraft };
    }

    if (this.index === -1) {
      this.stashedDraft = currentDraft;
      this.index = this.history.length - 1;
      return { changed: true, text: this.history[this.index] };
    }

    if (this.index > 0) {
      this.index--;
      return { changed: true, text: this.history[this.index] };
    }

    return { changed: false, text: this.history[this.index] };
  }

  navigateDown(currentDraft = '') {
    if (this.history.length === 0 || this.index === -1) {
      return { changed: false, text: currentDraft };
    }

    if (this.index < this.history.length - 1) {
      this.index++;
      return { changed: true, text: this.history[this.index] };
    }

    const restored = this.stashedDraft;
    this.reset();
    return { changed: true, text: restored };
  }
}

/**
 * Session wrapper that tracks programmatic writes so host draft updates
 * do not abort an in-progress history walk.
 */
export class PromptHistorySession {
  /**
   * @param {string} [sessionId]
   * @param {string[]} [history]
   * @param {number} [maxItems]
   */
  constructor(sessionId = GLOBAL_SESSION_ID, history = [], maxItems = DEFAULT_MAX_HISTORY) {
    this.sessionId = sessionId;
    this.state = new PromptHistoryState(history, maxItems);
    this.lastApplied = null;
  }

  get index() {
    return this.state.index;
  }

  get history() {
    return this.state.history;
  }

  get navigating() {
    return this.state.index !== -1;
  }

  reset() {
    this.state.reset();
    this.lastApplied = null;
  }

  record(prompt) {
    this.state.record(prompt);
    this.lastApplied = null;
  }

  sync(newHistory) {
    this.state.replaceHistory(newHistory);
  }

  navigate(direction, currentDraft) {
    const draft = typeof currentDraft === 'string' ? currentDraft : '';
    const result = direction === 'up'
      ? this.state.navigateUp(draft)
      : this.state.navigateDown(draft);
    if (result.changed) this.lastApplied = result.text;
    const preventDefault = direction === 'up'
      ? this.state.history.length > 0
      : this.state.index !== -1 || result.changed;
    return { ...result, preventDefault };
  }

  restoreDraft() {
    if (this.state.index === -1) return { changed: false, text: '' };
    const text = this.state.stashedDraft;
    this.state.reset();
    this.lastApplied = text;
    return { changed: true, text };
  }

  onExternalDraft(draft) {
    if (this.state.index === -1) return { reset: false };
    const text = typeof draft === 'string' ? draft : '';
    if (this.lastApplied !== null && text === this.lastApplied) return { reset: false };
    if (text === this.state.history[this.state.index]) return { reset: false };
    this.reset();
    return { reset: true };
  }
}

/**
 * Manager that holds isolated PromptHistorySession instances per sessionId.
 */
export class SessionHistoryManager {
  /**
   * @param {number} [maxItems]
   */
  constructor(maxItems = DEFAULT_MAX_HISTORY) {
    this.maxItems = maxItems;
    /** @type {Map<string, PromptHistorySession>} */
    this.sessions = new Map();
  }

  /**
   * Get or create history session for a given sessionId.
   * @param {string | undefined | null} sessionId
   * @param {string[]} [initialHistory]
   * @returns {PromptHistorySession}
   */
  get(sessionId, initialHistory) {
    const id = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : GLOBAL_SESSION_ID;
    let s = this.sessions.get(id);
    if (!s) {
      s = new PromptHistorySession(id, initialHistory || [], this.maxItems);
      this.sessions.set(id, s);
    } else if (initialHistory && initialHistory.length > 0 && s.history.length === 0) {
      s.sync(initialHistory);
    }
    return s;
  }

  /**
   * Clear in-memory session.
   * @param {string} sessionId
   */
  remove(sessionId) {
    const id = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : GLOBAL_SESSION_ID;
    this.sessions.delete(id);
  }
}
