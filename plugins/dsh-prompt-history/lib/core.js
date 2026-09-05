/**
 * Prompt History Navigator - Pure Core Logic
 *
 * Manages prompt history stacks, cursor navigation positions,
 * composer-target / overlay / send-button matching, and swipe classification.
 */

export const DEFAULT_MAX_HISTORY = 200;
export const MAX_PROMPT_CHARS = 8192;
export const STORAGE_KEY = 'dsh:prompt_history_v1';
export const SWIPE_MAX_MS = 400;
export const SWIPE_MIN_PX = 35;
export const SWIPE_VERTICAL_RATIO = 1.5;

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
 * Whether a DOM node is the conversation composer surface.
 * Matches Lexical `[data-composer-input]` and legacy textarea hosts.
 * Does not treat a bare `data-phase` attribute as sufficient.
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
 * Scoped to the composer; does not treat the always-mounted
 * `conversation.input.overlay` slot as an open menu.
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
 * Whether ArrowUp / swipe-up or ArrowDown / swipe-down should drive history.
 * While already browsing, line position is ignored so multi-line entries
 * remain reachable after the host places the caret at the end.
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
 * Coerce persisted JSON into a bounded string list.
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
 * State machine helper for navigating through prompt history.
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
   * Reset navigation index and clear stashed draft.
   */
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

  /**
   * Navigate backwards (older entry / ArrowUp).
   * @param {string} currentDraft
   * @returns {{ changed: boolean, text: string }}
   */
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

  /**
   * Navigate forwards (newer entry / ArrowDown).
   * @param {string} [currentDraft]
   * @returns {{ changed: boolean, text: string }}
   */
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
   * @param {string[]} [history]
   * @param {number} [maxItems]
   */
  constructor(history = [], maxItems = DEFAULT_MAX_HISTORY) {
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

  /**
   * @param {string} prompt
   */
  record(prompt) {
    this.state.record(prompt);
    this.lastApplied = null;
  }

  /**
   * @param {'up' | 'down'} direction
   * @param {string} currentDraft
   * @returns {{ changed: boolean, text: string, preventDefault: boolean }}
   */
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

  /**
   * @returns {{ changed: boolean, text: string }}
   */
  restoreDraft() {
    if (this.state.index === -1) return { changed: false, text: '' };
    const text = this.state.stashedDraft;
    this.state.reset();
    this.lastApplied = text;
    return { changed: true, text };
  }

  /**
   * Host published a new draft. Ignore the text we just applied.
   * @param {string} draft
   * @returns {{ reset: boolean }}
   */
  onExternalDraft(draft) {
    if (this.state.index === -1) return { reset: false };
    const text = typeof draft === 'string' ? draft : '';
    if (this.lastApplied !== null && text === this.lastApplied) return { reset: false };
    if (text === this.state.history[this.state.index]) return { reset: false };
    this.reset();
    return { reset: true };
  }
}
