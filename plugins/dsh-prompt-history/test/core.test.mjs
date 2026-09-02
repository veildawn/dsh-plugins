import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCaretOnFirstLine,
  isCaretOnLastLine,
  pushHistory,
  PromptHistoryState,
  DEFAULT_MAX_HISTORY,
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

  // Whitespace ignored
  hist = pushHistory(hist, '   ');
  assert.deepEqual(hist, ['first prompt', 'second prompt']);

  // Deduplication moves to end
  hist = pushHistory(hist, 'first prompt');
  assert.deepEqual(hist, ['second prompt', 'first prompt']);

  // Max limit
  let limited = ['1', '2', '3'];
  limited = pushHistory(limited, '4', 3);
  assert.deepEqual(limited, ['2', '3', '4']);
});

test('PromptHistoryState - up and down traversal with draft stashing', () => {
  const state = new PromptHistoryState(['cmd 1', 'cmd 2', 'cmd 3']);

  // Starting navigation from custom draft
  const up1 = state.navigateUp('my unfinished draft');
  assert.equal(up1.changed, true);
  assert.equal(up1.text, 'cmd 3');
  assert.equal(state.index, 2);

  // Older
  const up2 = state.navigateUp('cmd 3');
  assert.equal(up2.changed, true);
  assert.equal(up2.text, 'cmd 2');
  assert.equal(state.index, 1);

  // Oldest
  const up3 = state.navigateUp('cmd 2');
  assert.equal(up3.changed, true);
  assert.equal(up3.text, 'cmd 1');
  assert.equal(state.index, 0);

  // Cannot go beyond oldest
  const up4 = state.navigateUp('cmd 1');
  assert.equal(up4.changed, false);
  assert.equal(up4.text, 'cmd 1');
  assert.equal(state.index, 0);

  // Navigate back down
  const down1 = state.navigateDown();
  assert.equal(down1.changed, true);
  assert.equal(down1.text, 'cmd 2');
  assert.equal(state.index, 1);

  const down2 = state.navigateDown();
  assert.equal(down2.changed, true);
  assert.equal(down2.text, 'cmd 3');
  assert.equal(state.index, 2);

  // Beyond newest -> restores original stashed draft
  const down3 = state.navigateDown();
  assert.equal(down3.changed, true);
  assert.equal(down3.text, 'my unfinished draft');
  assert.equal(state.index, -1);

  // Further down does nothing
  const down4 = state.navigateDown();
  assert.equal(down4.changed, false);
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
