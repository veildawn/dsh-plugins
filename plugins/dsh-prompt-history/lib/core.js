/**
 * Prompt History Navigator - Pure Core Logic
 * 
 * Manages prompt history stacks, cursor navigation positions,
 * and text boundary (first-line/last-line) determinations.
 */

export const DEFAULT_MAX_HISTORY = 200;

/**
 * Check if the caret in a textarea is currently on the first line.
 * @param {string} text - current draft text
 * @param {number} selectionStart - start index of cursor selection
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
 * @param {string} text - current draft text
 * @param {number} selectionEnd - end index of cursor selection
 * @returns {boolean}
 */
export function isCaretOnLastLine(text, selectionEnd) {
  if (!text || selectionEnd >= text.length) return true;
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) return true;
  return selectionEnd > lastNewline;
}

/**
 * Normalize and push a new prompt to history stack.
 * Duplicates are deduplicated and moved to the most recent end.
 * @param {string[]} history - existing history array
 * @param {string} prompt - new prompt text
 * @param {number} [maxItems=200] - maximum history items to keep
 * @returns {string[]} new history array
 */
export function pushHistory(history, prompt, maxItems = DEFAULT_MAX_HISTORY) {
  const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmed) return [...history];

  const filtered = history.filter(item => item !== trimmed);
  filtered.push(trimmed);

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
   * @param {string[]} [history=[]]
   * @param {number} [maxItems=200]
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
   * @param {string} currentDraft - current draft text in input
   * @returns {{ changed: boolean, text: string }}
   */
  navigateUp(currentDraft) {
    if (this.history.length === 0) {
      return { changed: false, text: currentDraft };
    }

    if (this.index === -1) {
      // Starting navigation from current draft: stash it
      this.stashedDraft = currentDraft;
      this.index = this.history.length - 1;
      return { changed: true, text: this.history[this.index] };
    }

    if (this.index > 0) {
      this.index--;
      return { changed: true, text: this.history[this.index] };
    }

    // Already at oldest entry
    return { changed: false, text: this.history[this.index] };
  }

  /**
   * Navigate forwards (newer entry / ArrowDown).
   * @returns {{ changed: boolean, text: string }}
   */
  navigateDown() {
    if (this.history.length === 0 || this.index === -1) {
      return { changed: false, text: '' };
    }

    if (this.index < this.history.length - 1) {
      this.index++;
      return { changed: true, text: this.history[this.index] };
    }

    // Reached beyond newest entry: restore stashed draft
    const restored = this.stashedDraft;
    this.reset();
    return { changed: true, text: restored };
  }
}
