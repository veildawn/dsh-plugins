/**
 * Status-machine tests.
 *
 * `lib/status.js` is a pure transcription of Qoder's own predicates and
 * progress formulas, so these tests pin the transcription against the values
 * the Qoder UI actually shows, and then run the two properties that must hold
 * for every input rather than for the examples we happened to think of.
 *
 * Run: node --test test/status.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveStatus,
  hasDrift,
  hasWiki,
  isFailed,
  isIncremental,
  isRetryableFailure,
  isRunning,
  isSuccess,
  isTerminal,
  progressPercent,
  progressText,
  shouldNotifyCompletion,
  showsProgress,
  statusDescription,
  statusHeading,
  statusTitle,
  statusTone,
} from '../lib/status.js';
import { STATUS, SUCCESS_STATUSES, FAILED_STATUSES, RUNNING_STATUSES } from '../lib/constants.js';

/* ------------------------------------------------------------------------- *
 * A deterministic PRNG, so a failing property prints a reproducible input.
 * ------------------------------------------------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_STATUSES = Object.values(STATUS);

/* ------------------------------------------------------------------------- *
 * Example tests: the values Qoder's UI shows.
 * ------------------------------------------------------------------------- */

test('progress percent matches Qoder zgo', () => {
  assert.equal(progressPercent(STATUS.WIKI_INIT), 0);
  assert.equal(progressPercent(STATUS.WAITING), 10);
  assert.equal(progressPercent(STATUS.LINING), 10);
  assert.equal(progressPercent(STATUS.INITIALIZING), 20);
  assert.equal(progressPercent(STATUS.DIRECTORY_GENERATING, { total_catalogs: 0 }), 30);
  assert.equal(progressPercent(STATUS.DIRECTORY_GENERATING, { total_catalogs: 10, completed_catalogs: 10 }), 40);
  assert.equal(progressPercent(STATUS.DOCUMENT_GENERATING, { total_catalogs: 10, completed_catalogs: 0 }), 40);
  assert.equal(progressPercent(STATUS.DOCUMENT_GENERATING, { total_catalogs: 10, completed_catalogs: 10 }), 100);
  assert.equal(progressPercent(STATUS.COMPLETED), 100);
  assert.equal(progressPercent(STATUS.PARTLY_COMPLETED), 100);
  assert.equal(progressPercent(STATUS.PAUSED, { total_catalogs: 0 }), 30);
  assert.equal(progressPercent(STATUS.NETWORK_ERROR), 0);
});

test('incremental runs use the wider brackets', () => {
  const details = { total_catalogs: 10, completed_catalogs: 5, generation_type: 'INCREMENT' };
  assert.equal(progressPercent(STATUS.DIRECTORY_GENERATING, details), 40);
  assert.equal(progressPercent(STATUS.DOCUMENT_GENERATING, details), 75);
  const full = { ...details, generation_type: 'FULL' };
  assert.equal(progressPercent(STATUS.DIRECTORY_GENERATING, full), 35);
  assert.equal(progressPercent(STATUS.DOCUMENT_GENERATING, full), 70);
});

test('status titles and descriptions are the Qoder strings', () => {
  assert.equal(statusTitle(STATUS.WIKI_HAS_COMMIT), 'Wiki 有提交');
  assert.equal(statusTitle(STATUS.TOO_MANY_FILES_FAILED), '文件过多');
  assert.equal(statusTitle('NOT_A_STATUS'), '未知');
  assert.equal(statusDescription(STATUS.INITIALIZING), '正在初始化分析');
  assert.equal(statusDescription(STATUS.PAUSED), '生成已暂停');
  assert.equal(
    statusDescription(STATUS.TOO_MANY_FILES_FAILED, { max_file_count: 5000 }),
    '代码库文件数量超出 5000，暂不支持分析',
  );
  assert.equal(
    statusDescription(STATUS.COMPLETED, { total_catalogs: 10, completed_catalogs: 8, failed_catalogs: 2 }),
    '已完成 8/10，失败: 2',
  );
});

test('incremental headings swap to 更新 wording', () => {
  const incremental = { generation_type: 'INCREMENT' };
  assert.equal(statusHeading(STATUS.DIRECTORY_GENERATING, incremental), '更新目录中');
  assert.equal(statusHeading(STATUS.DOCUMENT_GENERATING, incremental), '更新文档中');
  assert.equal(statusHeading(STATUS.DIRECTORY_GENERATING, {}), '生成目录中');
});

test('progress text matches Qoder Vgo', () => {
  const text = progressText(STATUS.DOCUMENT_GENERATING, {
    total_catalogs: 10,
    completed_catalogs: 5,
    failed_catalogs: 1,
    processing_catalogs: 2,
  });
  assert.match(text, /5\/10/);
  assert.match(text, /50\.0%/);
  assert.equal(progressText(STATUS.DOCUMENT_GENERATING, { total_catalogs: 0 }), '');
});

test('classification predicates are Qoder Xin / yit / xNn', () => {
  assert.equal(isRunning(STATUS.DOCUMENT_GENERATING), true);
  assert.equal(isRunning(STATUS.COMPLETED), false);
  assert.equal(isFailed(STATUS.NETWORK_ERROR), true);
  assert.equal(isRetryableFailure(STATUS.NETWORK_ERROR), true);
  assert.equal(isRetryableFailure(STATUS.NO_FILE_FAILED), false);
  assert.equal(isTerminal(STATUS.PAUSED), true);
  assert.equal(isTerminal(STATUS.WAITING), false);
  assert.equal(isSuccess(STATUS.PARTLY_COMPLETED), true);
  assert.equal(isIncremental({ generation_type: 'INCREMENT' }), true);
  assert.equal(isIncremental({}), false);
});

test('hasWiki mirrors yit, including the catalog-count guard', () => {
  assert.equal(hasWiki(STATUS.COMPLETED), true);
  assert.equal(hasWiki(STATUS.WIKI_EXIST), true);
  // The whole Lzg drift triple is gated on a non-empty catalog table.
  assert.equal(hasWiki(STATUS.WIKI_HAS_CHANGE, { total_catalogs: 0 }), false);
  assert.equal(hasWiki(STATUS.WIKI_HAS_CHANGE, { total_catalogs: 3 }), true);
  assert.equal(hasWiki(STATUS.WIKI_HAS_COMMIT, { total_catalogs: 0 }), false);
  assert.equal(hasWiki(STATUS.WIKI_LOSS_COMMIT, { total_catalogs: 0 }), false);
  assert.equal(hasWiki(STATUS.WIKI_LOSS_COMMIT, { total_catalogs: 3 }), true);
  // Nzg-only members are never "readable wiki", even with rows on disk.
  assert.equal(hasWiki(STATUS.WIKI_LOAD_FAIL, { total_catalogs: 3 }), false);
  assert.equal(hasWiki(STATUS.SERVICE_RECOVERING, { total_catalogs: 3 }), false);
  assert.equal(hasWiki(STATUS.WIKI_INIT), false);
});

test('deriveStatus reports drift only when a wiki exists', () => {
  assert.equal(
    deriveStatus({ status: STATUS.COMPLETED, commitId: 'a', headCommit: 'b', totalCatalogs: 3 }),
    STATUS.WIKI_HAS_COMMIT,
  );
  assert.equal(
    deriveStatus({ status: STATUS.COMPLETED, commitId: 'a', headCommit: 'a', totalCatalogs: 3 }),
    STATUS.COMPLETED,
  );
  assert.equal(deriveStatus({ status: STATUS.COMPLETED, commitId: 'a', headCommit: 'b', totalCatalogs: 0 }), STATUS.WIKI_EXIST);
  assert.equal(deriveStatus({ status: STATUS.WIKI_INIT, totalCatalogs: 0 }), STATUS.WIKI_INIT);
  assert.equal(deriveStatus({ status: STATUS.DOCUMENT_GENERATING, totalCatalogs: 3 }), STATUS.DOCUMENT_GENERATING);
});

test('deriveStatus reports WIKI_LOSS_COMMIT when the recorded commit is unreachable', () => {
  // A rewritten branch (rebase / force push) loses the recorded commit:
  // commitReachable === false upgrades WIKI_HAS_COMMIT to WIKI_LOSS_COMMIT.
  const input = { status: STATUS.COMPLETED, commitId: 'a', headCommit: 'b', totalCatalogs: 3 };
  assert.equal(deriveStatus({ ...input, commitReachable: true }), STATUS.WIKI_HAS_COMMIT);
  assert.equal(deriveStatus({ ...input, commitReachable: false }), STATUS.WIKI_LOSS_COMMIT);
  // An unknown answer (git could not tell) keeps the usable path.
  assert.equal(deriveStatus({ ...input, commitReachable: undefined }), STATUS.WIKI_HAS_COMMIT);
  assert.equal(deriveStatus({ ...input, commitReachable: false, totalCatalogs: 0 }), STATUS.WIKI_EXIST);
});

test('completion notification only fires on a running → finished transition', () => {
  assert.equal(shouldNotifyCompletion({ previous: STATUS.DOCUMENT_GENERATING, next: STATUS.COMPLETED }), true);
  assert.equal(shouldNotifyCompletion({ previous: STATUS.COMPLETED, next: STATUS.COMPLETED }), false);
  assert.equal(shouldNotifyCompletion({ previous: STATUS.DOCUMENT_GENERATING, next: STATUS.DOCUMENT_GENERATING }), false);
  assert.equal(
    shouldNotifyCompletion({
      previous: STATUS.DOCUMENT_GENERATING,
      next: STATUS.COMPLETED,
      previousLanguage: 'zh',
      nextLanguage: 'en',
    }),
    false,
  );
});

test('tones and drift', () => {
  assert.equal(statusTone(STATUS.COMPLETED), 'ok');
  assert.equal(statusTone(STATUS.NETWORK_ERROR), 'err');
  assert.equal(statusTone(STATUS.PAUSED), 'warn');
  assert.equal(statusTone(STATUS.DOCUMENT_GENERATING), 'brand');
  assert.equal(statusTone(STATUS.WIKI_INIT), 'muted');
  assert.equal(hasDrift(STATUS.WIKI_HAS_COMMIT), true);
  assert.equal(hasDrift(STATUS.COMPLETED), false);
});

test('showsProgress hides a stuck bar on a paused empty run', () => {
  assert.equal(showsProgress(STATUS.DOCUMENT_GENERATING, {}), true);
  assert.equal(showsProgress(STATUS.PAUSED, { total_catalogs: 0 }), false);
  assert.equal(showsProgress(STATUS.PAUSED, { total_catalogs: 4 }), true);
  assert.equal(showsProgress(STATUS.COMPLETED, {}), false);
});

/* ------------------------------------------------------------------------- *
 * Property 1: progress stays in [0, 100] and is monotone in `completed`.
 * ------------------------------------------------------------------------- */

test('Property 1: progressPercent is bounded and monotone', () => {
  const random = mulberry32(0x5eed);
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const status = ALL_STATUSES[Math.floor(random() * ALL_STATUSES.length)];
    const total = Math.floor(random() * 50);
    const completed = total === 0 ? 0 : Math.floor(random() * (total + 1));
    const details = {
      total_catalogs: total,
      completed_catalogs: completed,
      generation_type: random() < 0.5 ? 'INCREMENT' : 'FULL',
    };
    const value = progressPercent(status, details);
    assert.ok(Number.isFinite(value), `progress must be finite for ${status}`);
    assert.ok(value >= 0 && value <= 100, `progress ${value} out of range for ${status}`);

    // Monotonicity: more completed pages never lowers the percentage.
    if (total > 0 && completed < total) {
      const more = progressPercent(status, { ...details, completed_catalogs: completed + 1 });
      assert.ok(more >= value, `progress decreased for ${status}: ${value} → ${more}`);
    }
  }
});

test('Property 1b: garbage input never throws or escapes the range', () => {
  const random = mulberry32(0xbeef);
  const junk = [undefined, null, -1, 1e9, Number.NaN, 'x', {}, [], true];
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const details = {
      total_catalogs: junk[Math.floor(random() * junk.length)],
      completed_catalogs: junk[Math.floor(random() * junk.length)],
      generation_type: random() < 0.5 ? 'INCREMENT' : undefined,
    };
    const status = ALL_STATUSES[Math.floor(random() * ALL_STATUSES.length)];
    const value = progressPercent(status, details);
    assert.ok(value >= 0 && value <= 100, `progress ${value} out of range`);
  }
});

/* ------------------------------------------------------------------------- *
 * Property 2: running / success / failed are mutually exclusive and cover the
 * status set exactly once.
 * ------------------------------------------------------------------------- */

test('Property 2: status classes are disjoint and exhaustive', () => {
  for (const status of ALL_STATUSES) {
    const flags = [isRunning(status), isSuccess(status), isFailed(status)].filter(Boolean).length;
    assert.ok(flags <= 1, `${status} belongs to ${flags} classes`);
    const classified =
      RUNNING_STATUSES.includes(status) || SUCCESS_STATUSES.includes(status) || FAILED_STATUSES.includes(status);
    if (status === STATUS.WIKI_INIT || status === STATUS.PAUSED || !classified) {
      // The idle and drift states are deliberately unclassified.
      assert.equal(flags, 0, `${status} should not be classified`);
    } else {
      assert.equal(flags, 1, `${status} should be classified exactly once`);
    }
  }
});

test('Property 2b: isTerminal is exactly success ∪ failure ∪ paused', () => {
  for (const status of ALL_STATUSES) {
    const expected = isSuccess(status) || isFailed(status) || status === STATUS.PAUSED;
    assert.equal(isTerminal(status), expected, `isTerminal disagreed for ${status}`);
  }
});
