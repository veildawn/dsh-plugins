/**
 * dsh-prompt-history client bundle
 * 
 * Provides shell-like command/prompt history navigation for DSH conversation composer.
 * Intercepts ArrowUp and ArrowDown keys to browse previously sent prompts,
 * automatically saves submitted drafts to localStorage, and safely restores stashed drafts.
 */

window.__ModuleLoader__.load({
  id: "dsh-prompt-history",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const STORAGE_KEY = "dsh:prompt_history_v1";
    const MAX_HISTORY = 200;

    /**
     * Read history list from localStorage
     * @returns {string[]}
     */
    function loadHistory() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    /**
     * Save history list to localStorage
     * @param {string[]} history
     */
    function saveHistory(history) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      } catch (e) {}
    }

    /**
     * Append and deduplicate a sent prompt
     * @param {string} prompt
     */
    function recordPrompt(prompt) {
      const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
      if (!trimmed) return;
      let history = loadHistory();
      history = history.filter((item) => item !== trimmed);
      history.push(trimmed);
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }
      saveHistory(history);
    }

    /**
     * Safely write value to React-controlled textarea
     * @param {HTMLTextAreaElement} textarea 
     * @param {string} text 
     */
    function setTextareaValue(textarea, text) {
      if (!textarea) return;
      const proto = Object.getPrototypeOf(textarea);
      const setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && typeof setter.set === "function") {
        setter.set.call(textarea, text);
      } else {
        textarea.value = text;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      // Place cursor at the end
      const len = text.length;
      try {
        textarea.setSelectionRange(len, len);
      } catch (e) {}
    }

    /**
     * Determine if caret is on the first line
     */
    function isCaretOnFirstLine(text, pos) {
      if (!text || pos <= 0) return true;
      const firstNewline = text.indexOf('\n');
      return firstNewline === -1 || pos <= firstNewline;
    }

    /**
     * Determine if caret is on the last line
     */
    function isCaretOnLastLine(text, pos) {
      if (!text || pos >= text.length) return true;
      const lastNewline = text.lastIndexOf('\n');
      return lastNewline === -1 || pos > lastNewline;
    }

    /**
     * Check if DSH input trigger popup menu is currently active
     */
    function isTriggerOverlayOpen() {
      return !!document.querySelector(
        '[data-slot="conversation.input.overlay"] > *, [data-input-trigger-menu], [role="menu"][data-open="true"], [role="listbox"]'
      );
    }

    // Navigation Session State
    let navIndex = -1; // -1: editing draft; >=0: index in history
    let stashedDraft = '';
    let lastHandledTextarea = null;

    function resetNavigation() {
      navIndex = -1;
      stashedDraft = '';
      lastHandledTextarea = null;
    }

    // Global capture listener for keydown on textarea
    function handleKeyDown(e) {
      const target = e.target;
      if (!target || target.tagName !== 'TEXTAREA') return;

      // Check if this is the conversation composer textarea
      const isComposer = target.closest('[data-composer-card]') !== null;
      if (!isComposer) return;

      const isComposing = e.isComposing || e.keyCode === 229;
      if (isComposing) return;

      // If user presses Enter (without Shift) to send, record the current prompt
      if (e.key === 'Enter' && !e.shiftKey) {
        if (!isTriggerOverlayOpen() && target.value.trim()) {
          recordPrompt(target.value);
          resetNavigation();
        }
        return;
      }

      // If arrow keys pressed, verify if menu overlay is open (let menu handle selection if open)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (isTriggerOverlayOpen()) return;

        const history = loadHistory();
        if (history.length === 0) return;

        const val = target.value;
        const selStart = target.selectionStart ?? 0;
        const selEnd = target.selectionEnd ?? 0;

        if (e.key === 'ArrowUp') {
          // Trigger up if cursor is at the first line
          if (isCaretOnFirstLine(val, selStart)) {
            if (navIndex === -1) {
              // Stash current unfinished draft
              stashedDraft = val;
              navIndex = history.length - 1;
              lastHandledTextarea = target;
              e.preventDefault();
              setTextareaValue(target, history[navIndex]);
            } else if (navIndex > 0) {
              navIndex--;
              lastHandledTextarea = target;
              e.preventDefault();
              setTextareaValue(target, history[navIndex]);
            } else if (navIndex === 0) {
              // Already at oldest entry; prevent default cursor jumping to index 0 if already handled
              e.preventDefault();
            }
          }
        } else if (e.key === 'ArrowDown') {
          // Trigger down if currently browsing history
          if (navIndex !== -1) {
            if (isCaretOnLastLine(val, selEnd)) {
              e.preventDefault();
              if (navIndex < history.length - 1) {
                navIndex++;
                setTextareaValue(target, history[navIndex]);
              } else {
                // Reached after the newest entry: restore stashed draft
                const restored = stashedDraft;
                resetNavigation();
                setTextareaValue(target, restored);
              }
            }
          }
        }
      } else if (e.key === 'Escape') {
        if (navIndex !== -1) {
          // Restore stashed draft on Escape
          const restored = stashedDraft;
          resetNavigation();
          setTextareaValue(target, restored);
        }
      }
    }

    // Reset history navigation index whenever user types or modifies text manually
    function handleInput(e) {
      const target = e.target;
      if (target && target.tagName === 'TEXTAREA' && target !== lastHandledTextarea) {
        if (navIndex !== -1) {
          resetNavigation();
        }
      }
      lastHandledTextarea = null;
    }

    // Touch gesture support for mobile devices without physical arrow keys
    let touchStartY = 0;
    let touchStartX = 0;
    let touchStartTime = 0;

    function handleTouchStart(e) {
      if (!e.touches || e.touches.length !== 1) return;
      const target = e.target;
      if (target?.tagName !== 'TEXTAREA') return;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      touchStartTime = Date.now();
    }

    function handleTouchEnd(e) {
      if (!e.changedTouches || e.changedTouches.length !== 1) return;
      const target = e.target;
      if (target?.tagName !== 'TEXTAREA') return;

      const isComposer = target.closest('[data-composer-card]') !== null;
      if (!isComposer) return;

      const deltaY = e.changedTouches[0].clientY - touchStartY;
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaTime = Date.now() - touchStartTime;

      // Fast vertical swipe (within 400ms, vertical distance > 35px, vertical dominant)
      if (deltaTime <= 400 && Math.abs(deltaY) > 35 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
        if (isTriggerOverlayOpen()) return;

        const history = loadHistory();
        if (history.length === 0) return;

        const val = target.value;
        const selStart = target.selectionStart ?? 0;
        const selEnd = target.selectionEnd ?? 0;

        if (deltaY < -35) {
          // Swipe Up: Navigate Up (Older History)
          if (isCaretOnFirstLine(val, selStart)) {
            if (navIndex === -1) {
              stashedDraft = val;
              navIndex = history.length - 1;
              lastHandledTextarea = target;
              setTextareaValue(target, history[navIndex]);
              if (navigator.vibrate) navigator.vibrate(10);
            } else if (navIndex > 0) {
              navIndex--;
              lastHandledTextarea = target;
              setTextareaValue(target, history[navIndex]);
              if (navigator.vibrate) navigator.vibrate(10);
            }
          }
        } else if (deltaY > 35) {
          // Swipe Down: Navigate Down (Newer History)
          if (navIndex !== -1 && isCaretOnLastLine(val, selEnd)) {
            if (navIndex < history.length - 1) {
              navIndex++;
              setTextareaValue(target, history[navIndex]);
              if (navigator.vibrate) navigator.vibrate(10);
            } else {
              const restored = stashedDraft;
              resetNavigation();
              setTextareaValue(target, restored);
              if (navigator.vibrate) navigator.vibrate(10);
            }
          }
        }
      }
    }

    // Also listen to submit button click if user clicks send icon instead of pressing Enter
    function handleClick(e) {
      const btn = e.target?.closest?.('button[type="submit"], button[aria-label*="Send"], button[aria-label*="发送"]');
      if (btn) {
        const area = document.querySelector('[data-composer-card] textarea');
        if (area && area.value.trim()) {
          recordPrompt(area.value);
          resetNavigation();
        }
      }
    }

    function apply(ctx) {
      if (typeof window === 'undefined') return;

      window.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('input', handleInput, true);
      window.addEventListener('click', handleClick, true);
      window.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
      window.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });

      ctx.on('dispose', () => {
        window.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('input', handleInput, true);
        window.removeEventListener('click', handleClick, true);
        window.removeEventListener('touchstart', handleTouchStart, true);
        window.removeEventListener('touchend', handleTouchEnd, true);
      });
    }

    exports.apply = apply;
    exports.inject = [];

    return module.exports;
  }
});
