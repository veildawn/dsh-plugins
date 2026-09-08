/**
 * dsh-prompt-history client bundle
 *
 * Shell-like prompt history for the DSH conversation composer.
 * - Bound per session: prompts in Session A never mix with Session B.
 * - Persisted on host (~/.dsh/prompt-history/<sessionId>.json) via trusted-host RPC,
 *   enabling seamless sync across browsers, devices, and tabs.
 * - Reads/writes drafts through conversation.input.left (useInput + inputActions.setDraft).
 * - Bubble Actions: hover on any sent user prompt to "✏️ Edit" or "🔄 Resend".
 * - Prompt History Drawer: quick-access history popover on composer toolbar.
 */

window.__ModuleLoader__.load({
  id: "dsh-prompt-history",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");

    const RPC_CHANNEL = "/dsh-prompt-history";
    const GLOBAL_SESSION_ID = "__global__";
    const STORAGE_KEY_PREFIX = "dsh:prompt_history_v2:";
    const MAX_HISTORY = 200;
    const MAX_PROMPT_CHARS = 8192;
    const SWIPE_MAX_MS = 400;
    const SWIPE_MIN_PX = 35;
    const SWIPE_VERTICAL_RATIO = 1.5;
    const COMPOSER_SLOT = "conversation.input.left";
    const STYLE_ID = "dsh-prompt-history-styles";

    function storageKey(sessionId) {
      const id = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : GLOBAL_SESSION_ID;
      return STORAGE_KEY_PREFIX + id;
    }

    function isCaretOnFirstLine(text, selectionStart) {
      if (!text || selectionStart <= 0) return true;
      const firstNewline = text.indexOf("\n");
      if (firstNewline === -1) return true;
      return selectionStart <= firstNewline;
    }

    function isComposerTarget(el) {
      if (!el || typeof el.closest !== "function") return false;
      const inComposerChrome = el.closest("[data-composer-card]") !== null
        || el.closest("[data-composer-seat]") !== null;
      if (!inComposerChrome) return false;
      if (el.closest("[data-composer-input]") !== null) return true;
      const tag = el.tagName;
      if (tag === "TEXTAREA" || el.closest("textarea") !== null) return true;
      return false;
    }

    function isTriggerMenuOpen(root) {
      if (!root || typeof root.querySelector !== "function") return false;
      return !!root.querySelector(
        "[data-trigger-menu], [data-composer-card] [role=\"listbox\"], [data-composer-seat] [role=\"listbox\"]",
      );
    }

    function isSendButton(el) {
      if (!el || typeof el.closest !== "function") return false;
      const btn = el.closest("button");
      if (!btn) return false;
      const inComposer = btn.closest("[data-composer-card]") !== null
        || btn.closest("[data-composer-seat]") !== null;
      if (!inComposer) return false;
      const label = btn.getAttribute?.("aria-label") || "";
      return /发送消息|Send message/i.test(label);
    }

    function isComposerSendKey(event) {
      if (!event) return false;
      if (event.isComposing || event.keyCode === 229) return false;
      if (event.altKey) return false;
      if (event.key !== "Enter") return false;
      if (event.shiftKey) return false;
      return true;
    }

    function classifySwipe(gesture) {
      const deltaX = Number(gesture?.deltaX) || 0;
      const deltaY = Number(gesture?.deltaY) || 0;
      const deltaTime = Number(gesture?.deltaTime) || 0;
      if (deltaTime > SWIPE_MAX_MS) return null;
      if (Math.abs(deltaY) < SWIPE_MIN_PX) return null;
      if (Math.abs(deltaY) <= Math.abs(deltaX) * SWIPE_VERTICAL_RATIO) return null;
      return deltaY < 0 ? "up" : "down";
    }

    function sanitizeHistory(raw, maxItems = MAX_HISTORY, maxChars = MAX_PROMPT_CHARS) {
      if (!Array.isArray(raw)) return [];
      const out = [];
      const seen = new Set();
      for (const item of raw) {
        if (typeof item !== "string") continue;
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

    function pushHistory(history, prompt, maxItems = MAX_HISTORY, maxChars = MAX_PROMPT_CHARS) {
      const trimmed = typeof prompt === "string" ? prompt.trim() : "";
      if (!trimmed) return Array.isArray(history) ? [...history] : [];
      const next = trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
      const filtered = (Array.isArray(history) ? history : []).filter((item) => item !== next);
      filtered.push(next);
      if (filtered.length > maxItems) filtered.splice(0, filtered.length - maxItems);
      return filtered;
    }

    function mergeHistories(local, remote, maxItems = MAX_HISTORY) {
      const cleanLocal = sanitizeHistory(local, maxItems);
      const cleanRemote = sanitizeHistory(remote, maxItems);
      const combined = [...cleanRemote];
      for (const item of cleanLocal) {
        if (!combined.includes(item)) combined.push(item);
      }
      if (combined.length > maxItems) return combined.slice(combined.length - maxItems);
      return combined;
    }

    function normalizeSessionId(sessionId) {
      return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : GLOBAL_SESSION_ID;
    }

    class PromptHistoryState {
      constructor(history = [], maxItems = MAX_HISTORY) {
        this.history = Array.isArray(history) ? [...history] : [];
        this.maxItems = maxItems;
        this.index = -1;
        this.stashedDraft = "";
      }
      replaceHistory(newHistory) {
        this.history = sanitizeHistory(newHistory, this.maxItems);
        if (this.index >= this.history.length) {
          this.index = this.history.length - 1;
        }
      }
      reset() {
        this.index = -1;
        this.stashedDraft = "";
      }
      record(prompt) {
        this.history = pushHistory(this.history, prompt, this.maxItems);
        this.reset();
      }
      navigateUp(currentDraft) {
        if (this.history.length === 0) return { changed: false, text: currentDraft };
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
      navigateDown(currentDraft = "") {
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

    class PromptHistorySession {
      constructor(sessionId = GLOBAL_SESSION_ID, history = [], maxItems = MAX_HISTORY) {
        this.sessionId = sessionId;
        this.state = new PromptHistoryState(history, maxItems);
        this.lastApplied = null;
      }
      get index() { return this.state.index; }
      get history() { return this.state.history; }
      get navigating() { return this.state.index !== -1; }
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
      adoptRemote(remote) {
        const merged = mergeHistories(this.history, remote, this.state.maxItems);
        this.state.replaceHistory(merged);
        return this.history;
      }
      navigate(direction, currentDraft) {
        const draft = typeof currentDraft === "string" ? currentDraft : "";
        const result = direction === "up"
          ? this.state.navigateUp(draft)
          : this.state.navigateDown(draft);
        if (result.changed) this.lastApplied = result.text;
        return result;
      }
      restoreDraft() {
        if (this.state.index === -1) return { changed: false, text: "" };
        const text = this.state.stashedDraft;
        this.state.reset();
        this.lastApplied = text;
        return { changed: true, text };
      }
      onExternalDraft(draft) {
        if (this.state.index === -1) return { reset: false };
        const text = typeof draft === "string" ? draft : "";
        if (this.lastApplied !== null && text === this.lastApplied) return { reset: false };
        if (text === this.state.history[this.state.index]) return { reset: false };
        this.reset();
        return { reset: true };
      }
    }

    function loadLocalHistory(sessionId) {
      try {
        const key = storageKey(sessionId);
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        return sanitizeHistory(JSON.parse(raw));
      } catch {
        return [];
      }
    }

    function saveLocalHistory(sessionId, history) {
      try {
        const key = storageKey(sessionId);
        localStorage.setItem(key, JSON.stringify(history));
      } catch {}
    }

    function setTextareaValue(textarea, text) {
      if (!textarea) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (typeof setter === "function") setter.call(textarea, text);
      else textarea.value = text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      const len = text.length;
      try { textarea.setSelectionRange(len, len); } catch {}
    }

    function findLegacyTextarea() {
      if (typeof document === "undefined") return null;
      return document.querySelector("[data-composer-card] textarea, [data-composer-seat] textarea");
    }

    function composerSurface(el) {
      if (!el || typeof el.closest !== "function") return null;
      return el.closest("[data-composer-input]")
        || (el.tagName === "TEXTAREA" ? el : el.closest("textarea"));
    }

    function getComposerCaret(el) {
      const surface = composerSurface(el) || el;
      if (!surface) return { text: "", start: 0, end: 0 };
      if (surface.tagName === "TEXTAREA") {
        return {
          text: surface.value || "",
          start: surface.selectionStart ?? 0,
          end: surface.selectionEnd ?? 0,
        };
      }
      const text = surface.innerText ?? surface.textContent ?? "";
      const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
      if (!sel || sel.rangeCount === 0 || !surface.contains(sel.anchorNode)) {
        return { text, start: 0, end: text.length };
      }
      try {
        const range = sel.getRangeAt(0);
        const pre = range.cloneRange();
        pre.selectNodeContents(surface);
        pre.setEnd(range.startContainer, range.startOffset);
        const start = pre.toString().length;
        return { text, start, end: start + range.toString().length };
      } catch {
        return { text, start: 0, end: text.length };
      }
    }

    function isVisualFirstLine(surface) {
      if (!surface || surface.tagName === "TEXTAREA") return null;
      try {
        const sel = window.getSelection?.();
        if (!sel || sel.rangeCount === 0 || !surface.contains(sel.anchorNode)) return null;
        const caret = sel.getRangeAt(0).cloneRange();
        caret.collapse(true);
        const caretRect = caret.getBoundingClientRect();
        const probe = document.createRange();
        probe.selectNodeContents(surface);
        probe.collapse(true);
        const firstRect = probe.getBoundingClientRect();
        if (!caretRect || !firstRect) return null;
        return Math.abs(caretRect.top - firstRect.top) < 6;
      } catch {
        return null;
      }
    }

    function eventElement(target) {
      if (!target) return null;
      return target.nodeType === 3 ? target.parentElement : target;
    }

    function extractUserBubbleText(el) {
      if (!el) return "";
      const bubble = (typeof el.querySelector === "function"
        ? el.querySelector('[class*="_bubble"]')
        : null) || el;
      const clone = bubble.cloneNode(true);
      if (clone.querySelectorAll) {
        const extraBlocks = clone.querySelectorAll('[class*="_referenceSummary"], [class*="_contextRow"], [role="status"]');
        for (const node of extraBlocks) node.remove();
      }
      return (clone.innerText ?? clone.textContent ?? "").trim();
    }

    function findUserRow(el) {
      if (!el || typeof el.closest !== "function") return null;
      return el.closest('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [class*="_userRow"]');
    }

    function findUserActions(userRow) {
      if (!userRow || typeof userRow.querySelector !== "function") return null;
      return userRow.querySelector('[class*="_actions"]');
    }

    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        .dsh-ph-btn {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: var(--dsw-alias-label-tertiary, #888);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px;
          transition: all 0.15s ease;
        }
        .dsh-ph-btn:hover {
          background: var(--dsw-alias-interactive-bg-hover, rgba(125,125,125,0.12));
          color: var(--dsw-alias-label-primary, #111);
        }
        .dsh-ph-btn svg {
          width: 14px;
          height: 14px;
        }
        .dsh-ph-action-btn,
        button.dsh-ph-action-btn {
          width: calc(28px + var(--dsh-content-font-delta, 0px)) !important;
          height: calc(28px + var(--dsh-content-font-delta, 0px)) !important;
          color: var(--dsw-alias-label-tertiary, #888) !important;
          cursor: pointer !important;
          background: transparent !important;
          border: none !important;
          border-radius: 28px !important;
          justify-content: center !important;
          align-items: center !important;
          padding: 6px !important;
          display: inline-flex !important;
          box-sizing: border-box !important;
          transition: background 80ms, color 80ms !important;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .dsh-ph-action-btn:hover {
          background: var(--dsw-alias-interactive-bg-hover, rgba(125,125,125,0.12)) !important;
          color: var(--dsw-alias-label-secondary, #333) !important;
        }
        .dsh-ph-action-btn svg {
          width: calc(15px + var(--dsh-content-font-delta, 0px)) !important;
          height: calc(15px + var(--dsh-content-font-delta, 0px)) !important;
          display: block !important;
        }
        .dsh-ph-backdrop {
          display: none;
        }
        .dsh-ph-popover {
          position: absolute;
          bottom: 100%;
          left: 0;
          margin-bottom: 8px;
          width: min(380px, 90vw);
          max-height: 320px;
          background: var(--dsw-alias-bg-layer-2, #fff);
          border: 1px solid var(--dsw-alias-border-l2, #ddd);
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.14);
          z-index: 2000;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: inherit;
        }
        .dsh-ph-sheet-handle {
          display: none;
        }
        @media (max-width: 768px) {
          .dsh-ph-toolbar-btn {
            display: none !important;
          }
        }
        @media (max-width: 768px), (pointer: coarse) {
          .dsh-ph-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(2px);
            z-index: 9998;
          }
          .dsh-ph-popover {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            width: 100vw;
            max-width: 100vw;
            max-height: min(70vh, 520px);
            margin-bottom: 0;
            border-radius: 18px 18px 0 0;
            border-left: none;
            border-right: none;
            border-bottom: none;
            box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.2);
            z-index: 9999;
            padding-bottom: max(16px, env(safe-area-inset-bottom, 16px));
          }
          .dsh-ph-sheet-handle {
            display: block;
            width: 38px;
            height: 4px;
            border-radius: 2px;
            background: var(--dsw-alias-border-l3, #ccc);
            margin: 8px auto 4px auto;
            flex: none;
          }
          .dsh-ph-btn:not(.dsh-ph-action-btn) {
            width: 32px;
            height: 32px;
            min-width: 32px;
            min-height: 32px;
            border-radius: 50%;
            background: var(--dsw-alias-interactive-bg-subtle, rgba(125,125,125,0.08));
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
          }
          .dsh-ph-btn:not(.dsh-ph-action-btn) svg {
            width: 16px;
            height: 16px;
          }
          .dsh-ph-item {
            min-height: 44px;
            padding: 10px 12px;
            font-size: 14px;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
          }
          .dsh-ph-item-actions .dsh-ph-btn {
            width: 36px;
            height: 36px;
            min-width: 36px;
            min-height: 36px;
          }
        }
        .dsh-ph-popover-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid var(--dsw-alias-border-l1, #eee);
          background: var(--dsw-alias-bg-layer-1, #fafafa);
          font-size: 12px;
          font-weight: 600;
          color: var(--dsw-alias-label-secondary, #666);
        }
        .dsh-ph-list {
          overflow-y: auto;
          flex: 1;
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .dsh-ph-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          line-height: 1.4;
          color: var(--dsw-alias-label-primary, #222);
          transition: background 0.1s ease;
        }
        .dsh-ph-item:hover {
          background: var(--dsw-alias-interactive-bg-hover, rgba(125,125,125,0.08));
        }
        .dsh-ph-item-text {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-right: 8px;
        }
        .dsh-ph-item-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: none;
        }
        .dsh-ph-empty {
          padding: 24px;
          text-align: center;
          color: var(--dsw-alias-label-caption, #999);
          font-size: 13px;
        }
      `;
      document.head.appendChild(style);
    }

    const inject = ["slots", "connection"];

    function apply(ctx) {
      if (typeof window === "undefined") return;
      ensureStyles();

      /** @type {Map<string, PromptHistorySession>} */
      const sessionMap = new Map();
      /** @type {Map<string, { recordedForPhase: boolean, lastNonEmptyDraft: string }>} */
      const sessionMeta = new Map();
      let activeSessionId = GLOBAL_SESSION_ID;
      const access = { draft: "", setDraft: null, submit: null, phase: "", sessionId: GLOBAL_SESSION_ID };
      let touchStartY = 0;
      let touchStartX = 0;
      let touchStartTime = 0;

      function metaFor(sessionId) {
        const id = normalizeSessionId(sessionId);
        let meta = sessionMeta.get(id);
        if (!meta) {
          meta = { recordedForPhase: false, lastNonEmptyDraft: "" };
          sessionMeta.set(id, meta);
        }
        return meta;
      }

      function getOrCreateSession(sessionId) {
        const id = normalizeSessionId(sessionId);
        let s = sessionMap.get(id);
        if (!s) {
          const local = loadLocalHistory(id);
          s = new PromptHistorySession(id, local);
          sessionMap.set(id, s);
        }
        return s;
      }

      function currentSession() {
        return getOrCreateSession(activeSessionId);
      }

      async function fetchHostHistory(sessionId) {
        const id = normalizeSessionId(sessionId);
        const rpc = ctx.connection?.rpc;
        if (!rpc || typeof rpc.call !== "function") return;
        try {
          const res = await rpc.call(RPC_CHANNEL, "load", { sessionId: id });
          if (res && res.ok && Array.isArray(res.value?.history)) {
            const s = sessionMap.get(id);
            if (s) {
              s.adoptRemote(res.value.history);
              saveLocalHistory(id, s.history);
            }
          }
        } catch {
          // RPC may fail if offline
        }
      }

      async function pushHostRecord(sessionId, prompt) {
        const id = normalizeSessionId(sessionId);
        const rpc = ctx.connection?.rpc;
        if (!rpc || typeof rpc.call !== "function") return;
        try {
          const res = await rpc.call(RPC_CHANNEL, "record", { sessionId: id, prompt });
          if (res && res.ok && Array.isArray(res.value?.history)) {
            const s = sessionMap.get(id);
            if (s) {
              s.adoptRemote(res.value.history);
              saveLocalHistory(id, s.history);
            }
          }
        } catch {
          // RPC failed
        }
      }

      function recordPrompt(prompt, sessionId) {
        const id = normalizeSessionId(sessionId ?? activeSessionId);
        const s = getOrCreateSession(id);
        s.record(prompt);
        saveLocalHistory(id, s.history);
        pushHostRecord(id, prompt);
      }

      function currentDraft(fallback) {
        if (typeof access.setDraft === "function") return access.draft || "";
        if (typeof fallback === "string") return fallback;
        return findLegacyTextarea()?.value ?? "";
      }

      function canWrite() {
        return typeof access.setDraft === "function" || !!findLegacyTextarea();
      }

      function applyDraft(text) {
        if (typeof access.setDraft === "function") {
          access.draft = text;
          access.setDraft(text);
          return;
        }
        const ta = findLegacyTextarea();
        if (ta) setTextareaValue(ta, text);
      }

      function applyDraftAndFocus(text) {
        applyDraft(text);
        const composer = document.querySelector("[data-composer-input], [data-composer-card] textarea");
        if (composer) {
          try {
            composer.focus();
            composer.scrollIntoView({ behavior: "smooth", block: "end" });
          } catch {}
        }
      }

      function resendPrompt(text) {
        applyDraft(text);
        if (typeof access.submit === "function") {
          access.submit();
          return;
        }
        const sendBtn = document.querySelector(
          '[data-composer-card] button[aria-label="发送消息"], [data-composer-card] button[aria-label="Send message"], [data-composer-seat] button[aria-label="发送消息"], [data-composer-seat] button[aria-label="Send message"]',
        );
        if (sendBtn) sendBtn.click();
      }

      function isWorkspaceTrigger(el) {
        const input = composerSurface(el);
        return input?.getAttribute?.("aria-haspopup") === "menu";
      }

      function handleKeyDown(e) {
        const target = e.target;
        const el = eventElement(target);
        if (!isComposerTarget(el)) return;
        if (isWorkspaceTrigger(el)) return;
        if (e.isComposing || e.keyCode === 229) return;

        const session = currentSession();

        if (e.key === "Escape") {
          if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
          const restored = session.restoreDraft();
          if (restored.changed) {
            e.preventDefault();
            applyDraft(restored.text);
          }
          return;
        }

        if (isComposerSendKey(e)) {
          if (!isTriggerMenuOpen(document)) {
            const draft = currentDraft(getComposerCaret(el).text);
            if (draft.trim()) recordPrompt(draft, access.sessionId);
          }
          return;
        }

        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        if (isTriggerMenuOpen(document)) return;
        if (!canWrite()) return;

        const caret = getComposerCaret(el);
        const draft = currentDraft(caret.text);
        const direction = e.key === "ArrowUp" ? "up" : "down";
        const visualFirst = isVisualFirstLine(composerSurface(el));
        const onFirstLine = visualFirst !== null
          ? visualFirst
          : isCaretOnFirstLine(caret.text, caret.start);

        if (!session.navigating) {
          if (direction !== "up" || !onFirstLine) return;
        }
        if (direction === "up" && session.history.length === 0) return;
        if (direction === "down" && !session.navigating) return;

        e.preventDefault();
        const result = session.navigate(direction, draft);
        if (result.changed) applyDraft(result.text);
      }

      function handleClick(e) {
        if (!isSendButton(e.target)) return;
        const draft = currentDraft();
        if (draft.trim()) recordPrompt(draft, access.sessionId);
      }

      function handleTouchStart(e) {
        if (!e.touches || e.touches.length !== 1) return;
        const el = eventElement(e.target);
        if (!isComposerTarget(el)) return;
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        touchStartTime = Date.now();
      }

      function handleTouchEnd(e) {
        if (!e.changedTouches || e.changedTouches.length !== 1) return;
        const el = eventElement(e.target);
        if (!isComposerTarget(el)) return;
        if (isWorkspaceTrigger(el)) return;
        if (isTriggerMenuOpen(document)) return;
        if (!canWrite()) return;

        const direction = classifySwipe({
          deltaX: e.changedTouches[0].clientX - touchStartX,
          deltaY: e.changedTouches[0].clientY - touchStartY,
          deltaTime: Date.now() - touchStartTime,
        });
        if (!direction) return;

        const session = currentSession();
        const caret = getComposerCaret(el);
        const draft = currentDraft(caret.text);
        const visualFirst = isVisualFirstLine(composerSurface(el));
        const onFirstLine = visualFirst !== null
          ? visualFirst
          : isCaretOnFirstLine(caret.text, caret.start);

        if (!session.navigating) {
          if (direction !== "up" || !onFirstLine) return;
        }
        if (direction === "up" && session.history.length === 0) return;
        if (direction === "down" && !session.navigating) return;

        const result = session.navigate(direction, draft);
        if (result.changed) {
          applyDraft(result.text);
          if (navigator.vibrate) navigator.vibrate(10);
        }
      }

      // --- User Bubble Edit / Resend Actions Decoration ---
      function decorateUserRow(userRow) {
        if (!userRow) return;
        const actionsContainer = findUserActions(userRow);
        if (!actionsContainer) return;

        // Strictly check if our buttons already exist inside the actions container
        if (actionsContainer.querySelector(".dsh-ph-action-btn, [data-dsh-ph-action]")) {
          userRow.dataset.dshPhDecorated = "true";
          return;
        }

        // Clean up any stale duplicate buttons before appending
        const existing = actionsContainer.querySelectorAll(".dsh-ph-action-btn, [data-dsh-ph-action]");
        for (const el of existing) el.remove();

        userRow.dataset.dshPhDecorated = "true";

        // Inherit host action classes from existing action buttons (e.g. copy button)
        const hostBtn = actionsContainer.querySelector("button");
        const hostClass = hostBtn && hostBtn.className ? hostBtn.className : "";
        const actionClass = (hostClass + " dsh-ph-action-btn").trim();

        // 1. Edit Button (✏️ 填回修改) - Exact matching IconEditOutline16
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = actionClass;
        editBtn.dataset.dshPhAction = "edit";
        editBtn.title = "填回输入框修改";
        editBtn.setAttribute("aria-label", "填回输入框修改");
        editBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z"/>
        </svg>`;
        editBtn.onclick = (e) => {
          e.stopPropagation();
          const text = extractUserBubbleText(userRow);
          if (text) applyDraftAndFocus(text);
        };

        // 2. Resend Button (🔄 立即重发) - Exact matching IconRefreshOutline16
        const resendBtn = document.createElement("button");
        resendBtn.type = "button";
        resendBtn.className = actionClass;
        resendBtn.dataset.dshPhAction = "resend";
        resendBtn.title = "重新发送此提示词";
        resendBtn.setAttribute("aria-label", "重新发送此提示词");
        resendBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M7.92136 0.349152C10.3744 0.349234 12.5564 1.5052 13.9557 3.29894L15.1281 2.12759C15.3303 1.92546 15.6767 2.06943 15.6767 2.35538V5.53923C15.6766 5.71626 15.5329 5.85976 15.3559 5.86002H12.171C11.8854 5.8597 11.7426 5.51465 11.9443 5.31249L12.9641 4.29056C11.8237 2.74305 9.98908 1.74106 7.92136 1.74097C4.46436 1.74097 1.66233 4.543 1.66233 8C1.66233 11.457 4.46436 14.259 7.92136 14.259C11.3782 14.2589 14.1804 11.4569 14.1804 8H15.5722C15.5722 12.2251 12.1465 15.6507 7.92136 15.6508C3.69614 15.6508 0.270508 12.2252 0.270508 8C0.270508 3.77478 3.69614 0.349152 7.92136 0.349152Z"/>
        </svg>`;
        resendBtn.onclick = (e) => {
          e.stopPropagation();
          const text = extractUserBubbleText(userRow);
          if (text) resendPrompt(text);
        };

        actionsContainer.appendChild(editBtn);
        actionsContainer.appendChild(resendBtn);
      }

      function decorateVisibleUserRows(root) {
        const scope = root && typeof root.querySelectorAll === "function" ? root : document;
        const rows = scope.querySelectorAll
          ? scope.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [class*="_userRow"]')
          : [];
        for (const row of rows) decorateUserRow(row);
        if (root && root.matches?.('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [class*="_userRow"]')) {
          decorateUserRow(root);
        }
      }

      function handleGlobalPointerOver(e) {
        const row = findUserRow(eventElement(e.target));
        if (row) decorateUserRow(row);
      }

      // --- Composer Toolbar History Trigger & Drawer ---
      function ComposerHistoryControl(props) {
        const [isOpen, setIsOpen] = react.useState(false);
        const [history, setHistory] = react.useState([]);
        const containerRef = react.useRef(null);

        const sid = normalizeSessionId(props?.sessionId);
        const useInput = props && typeof props.useInput === "function" ? props.useInput : null;
        const snapshot = useInput ? useInput((s) => s) : null;
        const draft = snapshot && typeof snapshot.draft === "string" ? snapshot.draft : "";
        const phase = snapshot ? snapshot.phase : "";
        const setDraft = props && props.inputActions ? props.inputActions.setDraft : null;
        const submit = props && props.inputActions ? props.inputActions.submit : null;

        react.useEffect(() => {
          activeSessionId = sid;
          access.sessionId = sid;
          getOrCreateSession(sid);
          fetchHostHistory(sid);
        }, [sid]);

        react.useEffect(() => {
          access.draft = draft;
          access.setDraft = typeof setDraft === "function" ? setDraft : null;
          access.submit = typeof submit === "function" ? submit : null;
          access.phase = phase || "";
          access.sessionId = sid;

          const meta = metaFor(sid);
          if (draft.trim()) meta.lastNonEmptyDraft = draft;

          const session = getOrCreateSession(sid);
          session.onExternalDraft(draft);

          const busy = phase === "submitting" || phase === "adjudicating";
          if (busy && !meta.recordedForPhase) {
            meta.recordedForPhase = true;
            const toRecord = (draft && draft.trim()) ? draft : meta.lastNonEmptyDraft;
            if (toRecord && toRecord.trim()) recordPrompt(toRecord, sid);
          } else if (!busy) {
            meta.recordedForPhase = false;
          }
        }, [sid, draft, phase, setDraft, submit]);

        const refreshHistory = () => {
          const s = getOrCreateSession(sid);
          setHistory([...s.history].reverse());
        };

        const toggleOpen = () => {
          if (!isOpen) refreshHistory();
          setIsOpen(!isOpen);
        };

        react.useEffect(() => {
          if (!isOpen) return;
          refreshHistory();
        }, [isOpen, sid, draft]);

        react.useEffect(() => {
          const handleExternalOpen = () => {
            refreshHistory();
            setIsOpen(true);
          };
          window.__dsh_open_prompt_history = handleExternalOpen;
          window.addEventListener("dsh:open-prompt-history", handleExternalOpen);
          return () => {
            if (window.__dsh_open_prompt_history === handleExternalOpen) {
              window.__dsh_open_prompt_history = undefined;
            }
            window.removeEventListener("dsh:open-prompt-history", handleExternalOpen);
          };
        }, [sid]);

        react.useEffect(() => {
          if (!isOpen) return;
          const onDocClick = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
              setIsOpen(false);
            }
          };
          document.addEventListener("mousedown", onDocClick);
          return () => document.removeEventListener("mousedown", onDocClick);
        }, [isOpen]);

        return react.createElement("div", {
          ref: containerRef,
          style: { position: "relative", display: "inline-flex", alignItems: "center" }
        },
          react.createElement("button", {
            type: "button",
            className: "dsh-ph-btn dsh-ph-toolbar-btn",
            title: "提示词历史",
            "aria-label": "提示词历史",
            onClick: toggleOpen
          },
            react.createElement("svg", { viewBox: "0 0 16 16", fill: "currentColor" },
              react.createElement("path", { d: "M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z" }),
              react.createElement("path", { d: "M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" })
            )
          ),
          isOpen && react.createElement(react.Fragment, null,
            react.createElement("div", {
              className: "dsh-ph-backdrop",
              onClick: () => setIsOpen(false)
            }),
            react.createElement("div", { className: "dsh-ph-popover" },
              react.createElement("div", { className: "dsh-ph-sheet-handle" }),
              react.createElement("div", { className: "dsh-ph-popover-header" },
              react.createElement("span", null, "提示词历史 (" + history.length + ")"),
              react.createElement("button", {
                type: "button",
                className: "dsh-ph-btn",
                title: "关闭",
                onClick: () => setIsOpen(false)
              }, "✕")
            ),
            react.createElement("div", { className: "dsh-ph-list" },
              history.length === 0
                ? react.createElement("div", { className: "dsh-ph-empty" }, "当前会话暂无历史提示词")
                : history.map((item, idx) => react.createElement("div", {
                    key: idx,
                    className: "dsh-ph-item",
                    onClick: () => {
                      applyDraftAndFocus(item);
                      setIsOpen(false);
                    }
                  },
                    react.createElement("span", { className: "dsh-ph-item-text", title: item }, item),
                    react.createElement("div", { className: "dsh-ph-item-actions" },
                      react.createElement("button", {
                        type: "button",
                        className: "dsh-ph-btn",
                        title: "填入输入框修改",
                        onClick: (e) => {
                          e.stopPropagation();
                          applyDraftAndFocus(item);
                          setIsOpen(false);
                        }
                      }, "✏️"),
                      react.createElement("button", {
                        type: "button",
                        className: "dsh-ph-btn",
                        title: "重新发送",
                        onClick: (e) => {
                          e.stopPropagation();
                          resendPrompt(item);
                          setIsOpen(false);
                        }
                      }, "🔄")
                    )
                  ))
            )
          )
        )
      );
      }

      if (ctx.slots && typeof ctx.slots.inject === "function") {
        ctx.slots.inject(COMPOSER_SLOT, () => ctx.slots.register({
          name: COMPOSER_SLOT,
          id: "prompt-history-composer",
          order: 90,
        }, ComposerHistoryControl));
      }

      const touchStartOpts = { capture: true, passive: true };
      const touchEndOpts = { capture: true, passive: true };
      const pointerOverOpts = { passive: true };
      const scrollOpts = { passive: true };

      let scrollTimer = null;
      function handleScroll() {
        if (scrollTimer !== null) return;
        scrollTimer = setTimeout(() => {
          scrollTimer = null;
          decorateVisibleUserRows(document);
        }, 120);
      }

      function handleGlobalTouchStart(e) {
        handleTouchStart(e);
        const row = findUserRow(eventElement(e.target));
        if (row) decorateUserRow(row);
      }

      window.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("click", handleClick, true);
      window.addEventListener("pointerover", handleGlobalPointerOver, pointerOverOpts);
      window.addEventListener("touchstart", handleGlobalTouchStart, touchStartOpts);
      window.addEventListener("touchend", handleTouchEnd, touchEndOpts);
      window.addEventListener("scroll", handleScroll, scrollOpts);

      decorateVisibleUserRows(document);
      let observer = null;
      if (typeof MutationObserver === "function") {
        observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node && node.nodeType === 1) decorateVisibleUserRows(node);
            }
          }
        });
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }

      ctx.on("dispose", () => {
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("click", handleClick, true);
        window.removeEventListener("pointerover", handleGlobalPointerOver, pointerOverOpts);
        window.removeEventListener("touchstart", handleGlobalTouchStart, touchStartOpts);
        window.removeEventListener("touchend", handleTouchEnd, touchEndOpts);
        window.removeEventListener("scroll", handleScroll, scrollOpts);
        if (scrollTimer !== null) clearTimeout(scrollTimer);
        observer?.disconnect();
        access.setDraft = null;
        access.submit = null;
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
