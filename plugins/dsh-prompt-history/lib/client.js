/**
 * dsh-prompt-history client bundle
 *
 * Shell-like prompt history for the DSH conversation composer.
 * - Bound per session: prompts in Session A never mix with Session B.
 * - Persisted on host (~/.dsh/prompt-history/<sessionId>.json) via trusted-host RPC,
 *   enabling seamless sync across browsers, devices, and tabs.
 * - Reads/writes drafts through conversation.input.left (useInput + inputActions.setDraft).
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

    const inject = ["slots", "connection"];

    function apply(ctx) {
      if (typeof window === "undefined") return;

      /** @type {Map<string, PromptHistorySession>} */
      const sessionMap = new Map();
      /** @type {Map<string, { recordedForPhase: boolean, lastNonEmptyDraft: string }>} */
      const sessionMeta = new Map();
      let activeSessionId = GLOBAL_SESSION_ID;
      const access = { draft: "", setDraft: null, phase: "", sessionId: GLOBAL_SESSION_ID };
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
          // RPC may fail if network drops; fallback stays with local
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
          // RPC failed; local state already updated
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

      function ComposerBridge(props) {
        const sid = normalizeSessionId(props?.sessionId);
        const useInput = props && typeof props.useInput === "function" ? props.useInput : null;
        const snapshot = useInput
          ? useInput((s) => s)
          : (props && props.input ? props.input : null);
        const draft = snapshot && typeof snapshot.draft === "string" ? snapshot.draft : "";
        const phase = snapshot ? snapshot.phase : "";
        const setDraft = props && props.inputActions ? props.inputActions.setDraft : null;

        react.useEffect(() => {
          activeSessionId = sid;
          getOrCreateSession(sid);
          fetchHostHistory(sid);
        }, [sid]);

        react.useEffect(() => {
          activeSessionId = sid;
          access.draft = draft;
          access.setDraft = typeof setDraft === "function" ? setDraft : null;
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

          return () => {
            if (access.setDraft === setDraft) access.setDraft = null;
          };
        }, [sid, draft, phase, setDraft]);

        return null;
      }

      if (ctx.slots && typeof ctx.slots.inject === "function") {
        ctx.slots.inject(COMPOSER_SLOT, () => ctx.slots.register({
          name: COMPOSER_SLOT,
          id: "prompt-history-composer",
          order: 100,
        }, ComposerBridge));
      }

      const touchStartOpts = { capture: true, passive: true };
      const touchEndOpts = { capture: true, passive: true };
      window.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("click", handleClick, true);
      window.addEventListener("touchstart", handleTouchStart, touchStartOpts);
      window.addEventListener("touchend", handleTouchEnd, touchEndOpts);

      ctx.on("dispose", () => {
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("click", handleClick, true);
        window.removeEventListener("touchstart", handleTouchStart, touchStartOpts);
        window.removeEventListener("touchend", handleTouchEnd, touchEndOpts);
        access.setDraft = null;
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
