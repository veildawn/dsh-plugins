import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCaretOnFirstLine,
  isCaretOnLastLine,
  isComposerTarget,
  isTriggerMenuOpen,
  isSendButton,
  classifySwipe,
  shouldHandleHistoryGesture,
  sanitizeHistory,
  pushHistory,
  PromptHistoryState,
  PromptHistorySession,
  DEFAULT_MAX_HISTORY,
  MAX_PROMPT_CHARS,
  SWIPE_MIN_PX,
} from '../lib/core.js';

test('isCaretOnFirstLine', () => {
  assert.equal(isCaretOnFirstLine('', 0), true);
  assert.equal(isCaretOnFirstLine('hello', 0), true);
  assert.equal(isCaretOnFirstLine('hello', 3), true);
  assert.equal(isCaretOnFirstLine('hello\nworld', 5), true); // at '\n'
  assert.equal(isCaretOnFirstLine('hello\nworld', 6), false); // on 2nd line
  assert.equal(isCaretOnFirstLine('line1\nline2\nline3', 2), true);
  assert.equal(isCaretOnFirstLine('line1\nline2\nline3', 7), false);
});

test('isCaretOnLastLine', () => {
  assert.equal(isCaretOnLastLine('', 0), true);
  assert.equal(isCaretOnLastLine('hello', 2), true);
  assert.equal(isCaretOnLastLine('hello', 5), true);
  assert.equal(isCaretOnLastLine('hello\nworld', 5), false); // on 1st line '\n'
  assert.equal(isCaretOnLastLine('hello\nworld', 6), true); // on 2nd line 'w'
  assert.equal(isCaretOnLastLine('line1\nline2\nline3', 10), false);
  assert.equal(isCaretOnLastLine('line1\nline2\nline3', 12), true); // on 3rd line
});

test('pushHistory - adds, trims, and deduplicates', () => {
  let hist = [];
  hist = pushHistory(hist, 'first prompt');
  assert.deepEqual(hist, ['first prompt']);

  hist = pushHistory(hist, 'second prompt');
  assert.deepEqual(hist, ['first prompt', 'second prompt']);

  hist = pushHistory(hist, '   ');
  assert.deepEqual(hist, ['first prompt', 'second prompt']);

  hist = pushHistory(hist, 'first prompt');
  assert.deepEqual(hist, ['second prompt', 'first prompt']);

  let limited = ['1', '2', '3'];
  limited = pushHistory(limited, '4', 3);
  assert.deepEqual(limited, ['2', '3', '4']);
});

test('pushHistory - truncates oversized prompts', () => {
  const long = 'x'.repeat(MAX_PROMPT_CHARS + 50);
  const hist = pushHistory([], long);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].length, MAX_PROMPT_CHARS);
});

test('sanitizeHistory - drops junk, caps length, and keeps newest', () => {
  assert.deepEqual(sanitizeHistory(null), []);
  assert.deepEqual(sanitizeHistory('nope'), []);
  assert.deepEqual(
    sanitizeHistory(['  a  ', '', 1, 'a', 'b', '   ']),
    ['a', 'b'],
  );
  const overflow = ['1', '2', '3', '4'];
  assert.deepEqual(sanitizeHistory(overflow, 2), ['3', '4']);
});

test('PromptHistoryState - up and down traversal with draft stashing', () => {
  const state = new PromptHistoryState(['cmd 1', 'cmd 2', 'cmd 3']);

  const up1 = state.navigateUp('my unfinished draft');
  assert.equal(up1.changed, true);
  assert.equal(up1.text, 'cmd 3');
  assert.equal(state.index, 2);

  const up2 = state.navigateUp('cmd 3');
  assert.equal(up2.changed, true);
  assert.equal(up2.text, 'cmd 2');
  assert.equal(state.index, 1);

  const up3 = state.navigateUp('cmd 2');
  assert.equal(up3.changed, true);
  assert.equal(up3.text, 'cmd 1');
  assert.equal(state.index, 0);

  const up4 = state.navigateUp('cmd 1');
  assert.equal(up4.changed, false);
  assert.equal(up4.text, 'cmd 1');
  assert.equal(state.index, 0);

  const down1 = state.navigateDown();
  assert.equal(down1.changed, true);
  assert.equal(down1.text, 'cmd 2');
  assert.equal(state.index, 1);

  const down2 = state.navigateDown();
  assert.equal(down2.changed, true);
  assert.equal(down2.text, 'cmd 3');
  assert.equal(state.index, 2);

  const down3 = state.navigateDown();
  assert.equal(down3.changed, true);
  assert.equal(down3.text, 'my unfinished draft');
  assert.equal(state.index, -1);

  const down4 = state.navigateDown('still here');
  assert.equal(down4.changed, false);
  assert.equal(down4.text, 'still here');
});

test('PromptHistoryState - record and reset', () => {
  const state = new PromptHistoryState(['cmd 1']);
  state.navigateUp('draft');
  assert.equal(state.index, 0);

  state.record('cmd 2');
  assert.equal(state.index, -1);
  assert.equal(state.stashedDraft, '');
  assert.deepEqual(state.history, ['cmd 1', 'cmd 2']);
});

test('PromptHistorySession - programmatic writes do not abort navigation', () => {
  const session = new PromptHistorySession(['alpha', 'beta']);
  const first = session.navigate('up', 'draft');
  assert.equal(first.changed, true);
  assert.equal(first.text, 'beta');
  assert.equal(session.onExternalDraft('beta').reset, false);
  assert.equal(session.navigating, true);

  const older = session.navigate('up', 'beta');
  assert.equal(older.text, 'alpha');
  assert.equal(session.onExternalDraft('alpha').reset, false);

  assert.equal(session.onExternalDraft('user typed this').reset, true);
  assert.equal(session.navigating, false);
});

test('PromptHistorySession - restoreDraft returns stash and clears index', () => {
  const session = new PromptHistorySession(['kept']);
  session.navigate('up', 'scratch');
  const restored = session.restoreDraft();
  assert.equal(restored.changed, true);
  assert.equal(restored.text, 'scratch');
  assert.equal(session.navigating, false);
  assert.equal(session.restoreDraft().changed, false);
});

test('shouldHandleHistoryGesture - first/last line only until navigating', () => {
  const idle = { navigating: false, text: 'line1\nline2', caretStart: 8, caretEnd: 8 };
  assert.equal(shouldHandleHistoryGesture('up', idle), false);
  assert.equal(shouldHandleHistoryGesture('down', idle), false);

  const top = { navigating: false, text: 'line1\nline2', caretStart: 2, caretEnd: 2 };
  assert.equal(shouldHandleHistoryGesture('up', top), true);
  assert.equal(shouldHandleHistoryGesture('down', top), false);

  const browsing = { navigating: true, text: 'multi\nline', caretStart: 11, caretEnd: 11 };
  assert.equal(shouldHandleHistoryGesture('up', browsing), true);
  assert.equal(shouldHandleHistoryGesture('down', browsing), true);
});

test('isComposerTarget - requires composer chrome plus input surface', () => {
  const closest = (map) => (sel) => (map[sel] ? { found: sel } : null);
  const lexical = {
    closest: closest({
      '[data-composer-card]': true,
      '[data-composer-input]': true,
    }),
    tagName: 'DIV',
  };
  assert.equal(isComposerTarget(lexical), true);

  const textarea = {
    closest: closest({ '[data-composer-seat]': true, textarea: true }),
    tagName: 'TEXTAREA',
  };
  assert.equal(isComposerTarget(textarea), true);

  const phaseOnly = {
    closest: closest({}),
    tagName: 'DIV',
    getAttribute: () => 'active',
  };
  assert.equal(isComposerTarget(phaseOnly), false);

  const chromeWithoutInput = {
    closest: closest({ '[data-composer-card]': true }),
    tagName: 'DIV',
  };
  assert.equal(isComposerTarget(chromeWithoutInput), false);
  assert.equal(isComposerTarget(null), false);
});

test('isTriggerMenuOpen - composer menus only, not overlay slot children', () => {
  const hits = (selector) => ({
    querySelector: (sel) => (sel.includes(selector) ? {} : null),
  });
  assert.equal(isTriggerMenuOpen(hits('[data-trigger-menu]')), true);
  assert.equal(isTriggerMenuOpen(hits('[role="listbox"]')), true);
  assert.equal(isTriggerMenuOpen({ querySelector: () => null }), false);
  assert.equal(isTriggerMenuOpen(null), false);
});

test('isSendButton - composer primary send labels only', () => {
  const send = {
    closest: (sel) => {
      if (sel === 'button') {
        return {
          closest: (inner) => (inner === '[data-composer-card]' ? {} : null),
          getAttribute: () => '发送消息',
        };
      }
      return null;
    },
  };
  assert.equal(isSendButton(send), true);

  const stop = {
    closest: (sel) => {
      if (sel === 'button') {
        return {
          closest: (inner) => (inner === '[data-composer-card]' ? {} : null),
          getAttribute: () => '停止',
        };
      }
      return null;
    },
  };
  assert.equal(isSendButton(stop), false);
});

test('classifySwipe - fast vertical flicks only', () => {
  assert.equal(classifySwipe({ deltaX: 0, deltaY: -(SWIPE_MIN_PX + 1), deltaTime: 120 }), 'up');
  assert.equal(classifySwipe({ deltaX: 0, deltaY: SWIPE_MIN_PX + 1, deltaTime: 120 }), 'down');
  assert.equal(classifySwipe({ deltaX: 80, deltaY: -40, deltaTime: 120 }), null);
  assert.equal(classifySwipe({ deltaX: 0, deltaY: -80, deltaTime: 800 }), null);
  assert.equal(classifySwipe({ deltaX: 0, deltaY: -10, deltaTime: 80 }), null);
});

test('DEFAULT_MAX_HISTORY is 200', () => {
  assert.equal(DEFAULT_MAX_HISTORY, 200);
});
