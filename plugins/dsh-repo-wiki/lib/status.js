/**
 * dsh-repo-wiki — the `wiki_present_status` state machine.
 *
 * Every function here is a pure function of its arguments. That is deliberate:
 * these are the rules a Qoder user already knows, so they are the part most
 * worth pinning with property tests, and pinning them needs no filesystem, no
 * host process and no network.
 *
 * The formulas are transcribed from Qoder CN 1.35.0
 * (`out/lingma/agents-window/agents-window.desktop.main.js`):
 *
 *   - `zgo` → {@link progressPercent}
 *   - `Vgo` → {@link progressText}
 *   - `J7r` → {@link statusDescription}
 *   - `xit` → {@link statusTitle}
 *   - `Xin` → {@link isRunning}
 *   - `yit` → {@link hasWiki}
 *   - `xNn` → {@link isRetryableFailure}
 *   - `Mgo` → {@link isIncremental}
 *
 * @module dsh-repo-wiki/status
 */

import {
  DRIFT_STATUSES,
  FAILED_STATUSES,
  GENERATION_TYPE,
  RUNNING_STATUSES,
  STATUS,
  SUCCESS_STATUSES,
} from './constants.js';

/** Clamp a number into `[lo, hi]`; non-finite input collapses to `lo`. */
function clamp(value, lo, hi) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/** Coerce a detail counter to a non-negative integer. */
function count(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Whether the status describes an incremental run.
 * @param {object} [details]
 * @returns {boolean}
 */
export function isIncremental(details) {
  return details?.generation_type === GENERATION_TYPE.increment;
}

/**
 * Whether the pipeline is actively advancing.
 * @param {string} [status]
 * @returns {boolean}
 */
export function isRunning(status) {
  return typeof status === 'string' && RUNNING_STATUSES.includes(status);
}

/**
 * Whether the status is a terminal failure.
 * @param {string} [status]
 * @returns {boolean}
 */
export function isFailed(status) {
  return typeof status === 'string' && FAILED_STATUSES.includes(status);
}

/**
 * Whether the status is a terminal success.
 * @param {string} [status]
 * @returns {boolean}
 */
export function isSuccess(status) {
  return typeof status === 'string' && SUCCESS_STATUSES.includes(status);
}

/**
 * Whether the pipeline is no longer advancing: success, failure, or paused.
 * @param {string} [status]
 * @returns {boolean}
 */
export function isTerminal(status) {
  return isSuccess(status) || isFailed(status) || status === STATUS.PAUSED;
}

/**
 * Whether a failure is worth retrying verbatim.
 *
 * Qoder retries the infrastructure failures and not the precondition ones: a
 * repository with no files will not grow files just because we ask again.
 * @param {string} [status]
 * @returns {boolean}
 */
export function isRetryableFailure(status) {
  return (
    status === STATUS.INITIALIZING_FAILED ||
    status === STATUS.DIRECTORY_FAILED ||
    status === STATUS.DOCUMENT_FAILED ||
    status === STATUS.NETWORK_ERROR
  );
}

/**
 * Whether the status means a readable wiki exists.
 *
 * Mirrors Qoder's `yit`: a completed/partial run has content, and a drift
 * status only counts when the catalog table is non-empty (a "wiki exists" flag
 * over an empty tree is a stale marker, not content).
 * @param {string} [status]
 * @param {object} [details]
 * @returns {boolean}
 */
export function hasWiki(status, details) {
  if (typeof status !== 'string' || status === '') return false;
  if (SUCCESS_STATUSES.includes(status)) return true;
  if (status === STATUS.WIKI_EXIST) return true;
  // Qoder's `yit` guards the whole `Lzg` drift triple — WIKI_HAS_CHANGE,
  // WIKI_HAS_COMMIT, WIKI_LOSS_COMMIT — behind a non-empty catalog table.
  // `WIKI_LOAD_FAIL` and `SERVICE_RECOVERING` are not "a wiki you can read",
  // even with rows on disk.
  if (hasDrift(status)) return count(details?.total_catalogs) > 0;
  return false;
}

/**
 * Whether the working tree moved past the recorded commit.
 * @param {string} [status]
 * @returns {boolean}
 */
export function hasDrift(status) {
  return (
    status === STATUS.WIKI_HAS_COMMIT ||
    status === STATUS.WIKI_HAS_CHANGE ||
    status === STATUS.WIKI_LOSS_COMMIT
  );
}

/**
 * Progress percentage, 0–100.
 *
 * Transcribed from Qoder's `zgo`. The two generation stages interpolate
 * against `completed_catalogs / total_catalogs`, with a different bracket for
 * incremental runs because the directory stage does less work and the document
 * stage does proportionally more.
 * @param {string} [status]
 * @param {object} [details]
 * @returns {number} integer percentage in `[0, 100]`
 */
export function progressPercent(status, details) {
  if (typeof status !== 'string' || status === '') return 0;
  const total = count(details?.total_catalogs);
  const done = count(details?.completed_catalogs);
  const ratio = total > 0 ? clamp(done / total, 0, 1) : 0;
  const incremental = isIncremental(details);
  switch (status) {
    case STATUS.COMPLETED:
    case STATUS.PARTLY_COMPLETED:
      return 100;
    case STATUS.WAITING:
    case STATUS.LINING:
      return 10;
    case STATUS.INITIALIZING:
      return 20;
    case STATUS.DIRECTORY_GENERATING:
      return Math.round(incremental ? 30 + ratio * 20 : 30 + ratio * 10);
    case STATUS.DOCUMENT_GENERATING:
      return Math.round(incremental ? 50 + ratio * 50 : 40 + ratio * 60);
    case STATUS.PAUSED:
      if (total > 0) return Math.round(incremental ? 50 + ratio * 50 : 40 + ratio * 60);
      return 30;
    default:
      return 0;
  }
}

/**
 * Whether `progressPercent` should render a progress bar at all.
 *
 * `PAUSED` before any catalog exists sits at a flat 30, which would look like a
 * stuck bar; Qoder shows the description instead.
 * @param {string} [status]
 * @param {object} [details]
 * @returns {boolean}
 */
export function showsProgress(status, details) {
  return isRunning(status) || (status === STATUS.PAUSED && count(details?.total_catalogs) > 0);
}

/**
 * The status heading, matching Qoder's `xit` map.
 * @param {string} [status]
 * @returns {string}
 */
export function statusTitle(status) {
  switch (status) {
    case STATUS.WIKI_INIT:
      return 'Wiki 初始化';
    case STATUS.WAITING:
      return '等待中';
    case STATUS.LINING:
      return '排队中';
    case STATUS.INITIALIZING:
      return '初始化中';
    case STATUS.DIRECTORY_GENERATING:
      return '生成目录中';
    case STATUS.DOCUMENT_GENERATING:
      return '生成文档中';
    case STATUS.COMPLETED:
      return '已完成';
    case STATUS.PARTLY_COMPLETED:
      return '部分完成';
    case STATUS.PAUSED:
      return '已暂停';
    case STATUS.INITIALIZING_FAILED:
      return '初始化失败';
    case STATUS.NETWORK_ERROR:
      return '网络错误';
    case STATUS.DIRECTORY_FAILED:
      return '目录生成失败';
    case STATUS.DOCUMENT_FAILED:
      return '文档生成失败';
    case STATUS.NOT_SOURCE_CONTROL_FAILED:
      return '非版本控制';
    case STATUS.TOO_MANY_FILES_FAILED:
      return '文件过多';
    case STATUS.TOO_MANY_WORKSPACE_FAILED:
      return '代码库数量超限';
    case STATUS.NO_FILE_FAILED:
      return '无文件';
    case STATUS.NO_COMMIT_HISTORY_FAILED:
      return '无提交历史';
    case STATUS.INSUFFICIENT_REMAINING_SEATS_FAILED:
      // Qoder's `xit` has no entry for this status and falls back to the raw
      // name; the explanatory sentence lives in the description.
      return 'INSUFFICIENT_REMAINING_SEATS_FAILED';
    case STATUS.WIKI_EXIST:
      return 'Wiki 已存在';
    case STATUS.WIKI_HAS_COMMIT:
      return 'Wiki 有提交';
    case STATUS.WIKI_HAS_CHANGE:
      return 'Wiki 有变更';
    case STATUS.WIKI_LOSS_COMMIT:
      return 'Wiki 丢失提交';
    case STATUS.WIKI_LOAD_FAIL:
      return 'Wiki 加载失败';
    case STATUS.SERVICE_RECOVERING:
      return '服务自动恢复中，请等待或重启';
    default:
      return '未知';
  }
}

/** Internal: Qoder swaps two headings during an incremental run. */
function isIncrementalStage(status) {
  return status === STATUS.DIRECTORY_GENERATING || status === STATUS.DOCUMENT_GENERATING;
}

/**
 * The status heading, with the incremental-run wording applied when it applies.
 * @param {string} [status]
 * @param {object} [details]
 * @returns {string}
 */
export function statusHeading(status, details) {
  if (isIncremental(details) && isIncrementalStage(status)) {
    return status === STATUS.DIRECTORY_GENERATING ? '更新目录中' : '更新文档中';
  }
  return statusTitle(status);
}

/**
 * The status description, matching Qoder's `J7r`.
 * @param {string} [status]
 * @param {object} [details]
 * @returns {string}
 */
export function statusDescription(status, details) {
  if (typeof status !== 'string' || status === '') return '等待获取状态…';
  const total = count(details?.total_catalogs);
  const done = count(details?.completed_catalogs);
  const failed = count(details?.failed_catalogs);
  const processing = count(details?.processing_catalogs);
  const incremental = isIncremental(details);

  if (status === STATUS.INITIALIZING) return '正在初始化分析';
  if (status === STATUS.DIRECTORY_GENERATING || status === STATUS.DOCUMENT_GENERATING) {
    if (total > 0) return progressText(status, details);
    return status === STATUS.DIRECTORY_GENERATING ? '正在生成文档目录结构' : '正在生成文档内容';
  }
  if (status === STATUS.COMPLETED) {
    if (incremental) return '已根据最新提交更新';
    if (total > 0) return `已完成 ${done}/${total}，失败: ${failed}`;
    return '文档生成完成';
  }
  if (status === STATUS.PARTLY_COMPLETED) {
    if (total > 0) return `已完成 ${done}/${total}，失败: ${failed}`;
    return '正在生成文档内容';
  }
  if (status === STATUS.PAUSED) return '生成已暂停';
  if (status === STATUS.INITIALIZING_FAILED) return '初始化过程中发生错误';
  if (status === STATUS.NETWORK_ERROR) return '请检查网络连接后重试。';
  if (status === STATUS.DIRECTORY_FAILED) return '目录生成失败，可重新生成';
  if (status === STATUS.DOCUMENT_FAILED) return '文档生成过程中发生错误';
  if (status === STATUS.NO_FILE_FAILED) {
    return '当前文件夹没有任何文件，无法生成 Wiki。请先在资源管理器中添加至少一个有效文件，然后重试。';
  }
  if (status === STATUS.NOT_SOURCE_CONTROL_FAILED) return '仅处理源代码管理项目';
  if (status === STATUS.TOO_MANY_FILES_FAILED) {
    const max = count(details?.max_file_count) || 10000;
    return `代码库文件数量超出 ${max}，暂不支持分析`;
  }
  if (status === STATUS.TOO_MANY_WORKSPACE_FAILED) return '已超出账号可分析的代码库数量限制。';
  if (status === STATUS.NO_COMMIT_HISTORY_FAILED) {
    return '当前工程无提交记录，无法生成 Wiki。请提交代码。';
  }
  if (status === STATUS.INSUFFICIENT_REMAINING_SEATS_FAILED) {
    return '您已达到该功能 Beta 期间提供的免费体验限额，暂时无法继续体验，请等待该功能正式发布后按需增购。';
  }
  if (status.includes('FAILED')) return '生成失败，请重试';
  if (status === STATUS.WAITING || status === STATUS.LINING) {
    const wait = details?.line_up_wait_time;
    if (typeof wait === 'number' && wait > 0) {
      if (wait <= 0.5) return '预计半小时内开始分析并生成。';
      const hours = Math.ceil(wait);
      if (wait <= 5) return `当前排队中，预计 ${hours} 小时内开始分析。`;
      return `当前队列较长，预计超过 ${hours} 小时。我们会在就绪后尽快处理。`;
    }
    // Qoder separates the two queue states, and the incremental variant.
    if (incremental) return '等待开始分析代码变更';
    return status === STATUS.WAITING ? '等待开始分析' : '排队等待处理';
  }
  if (status === STATUS.WIKI_INIT) return '请选择语言生成wiki';
  if (status === STATUS.WIKI_EXIST) return '数据库中已存在 Wiki。您可以将其导出到本地 repowiki 目录，或重新生成 Wiki。';
  if (status === STATUS.WIKI_HAS_CHANGE) return '检测到本地 repowiki 目录有更新，是否导入到数据库？';
  if (status === STATUS.WIKI_HAS_COMMIT) {
    // Qoder's `kPl` three variants, driven by which commit facts are known.
    const last = typeof details?.last_commit === 'string' ? details.last_commit : '';
    const current = typeof details?.current_commit === 'string' ? details.current_commit : '';
    if (last !== '' && current !== '' && details?.commit_diff_files !== undefined) {
      return `代码已更新。当前 Wiki 基于commit ${last.slice(0, 12)}，但最新的版本为${current.slice(0, 12)}（共${count(details.commit_diff_files)}个文件变更）。是否更新 Wiki？`;
    }
    if (last === '' && current !== '') return `代码已更新。当前最新版本为 ${current.slice(0, 12)}，是否更新Wiki？`;
    return '代码已更新。是否更新 Wiki？';
  }
  if (status === STATUS.WIKI_LOSS_COMMIT) {
    const last = typeof details?.last_commit === 'string' ? details.last_commit : '';
    const current = typeof details?.current_commit === 'string' ? details.current_commit : '';
    if (last !== '' && current !== '') return '无法复用已有 Wiki 进行更新，是否重新生成 Wiki？';
    return 'Wiki 生成已完成。可重新生成 Wiki，同步最新改动。';
  }
  if (status === STATUS.WIKI_LOAD_FAIL) return 'Git 目录变更导致 Wiki 加载失败。 是否重新生成？';
  if (status === STATUS.SERVICE_RECOVERING) return '服务自动恢复中，请等待或重启';
  if (processing > 0) return '处理中…';
  return status;
}

/**
 * The `已完成 x/y (p%)，处理中: z，失败: w` line, matching Qoder's `Vgo`.
 * @param {string} [status]
 * @param {object} [details]
 * @returns {string} empty string when there is nothing to count
 */
export function progressText(status, details) {
  const total = count(details?.total_catalogs);
  if (total === 0) return '';
  const done = count(details?.completed_catalogs);
  const failed = count(details?.failed_catalogs);
  const processing = count(details?.processing_catalogs);
  const percent = ((done / total) * 100).toFixed(1);
  const prefix = isIncremental(details) ? '已完成' : '正在生成中，已完成';
  return `${prefix} ${done}/${total} (${percent}%)，处理中: ${processing}，失败: ${failed}`;
}

/**
 * Whether the generation completion notification should fire.
 *
 * Qoder only notifies on a running → success/failure transition, and suppresses
 * the notification when the language changed mid-run (the user is looking at a
 * different tree by then).
 * @param {{ previous?: string, next?: string, previousLanguage?: string, nextLanguage?: string }} transition
 * @returns {boolean}
 */
export function shouldNotifyCompletion(transition) {
  const previous = transition?.previous;
  const next = transition?.next;
  if (!isRunning(previous)) return false;
  const finished = isSuccess(next) || isFailed(next);
  if (!finished) return false;
  const languageChanged =
    transition?.previousLanguage !== undefined &&
    transition?.previousLanguage !== null &&
    transition.previousLanguage !== transition.nextLanguage;
  return !languageChanged;
}

/**
 * Derive the effective status of a stored wiki against the working tree.
 *
 * A stored `COMPLETED` wiki whose recorded commit differs from HEAD is not
 * still "completed" from the reader's point of view — it describes an older
 * tree. Qoder models this as `WIKI_HAS_COMMIT`; we do the same, and only when a
 * wiki actually exists.
 * @param {{ status?: string, commitId?: string, headCommit?: string|null, totalCatalogs?: number }} input
 * @returns {string}
 */
export function deriveStatus(input) {
  const stored = typeof input?.status === 'string' && input.status !== '' ? input.status : STATUS.WIKI_INIT;
  const total = count(input?.totalCatalogs);
  if (stored === STATUS.WIKI_INIT && total === 0) return STATUS.WIKI_INIT;
  if (isRunning(stored) || stored === STATUS.PAUSED || isFailed(stored)) return stored;
  const head = typeof input?.headCommit === 'string' && input.headCommit !== '' ? input.headCommit : null;
  const recorded = typeof input?.commitId === 'string' && input.commitId !== '' ? input.commitId : null;
  if (head !== null && recorded !== null && head !== recorded) {
    // A recorded commit that is no longer reachable from HEAD — the branch was
    // rebased or force-pushed — means the stored tree describes history that no
    // longer exists. Qoder calls that `WIKI_LOSS_COMMIT` and only offers a full
    // regenerate, because an incremental diff against a rewritten base lies.
    if (input?.commitReachable === false) return total > 0 ? STATUS.WIKI_LOSS_COMMIT : STATUS.WIKI_EXIST;
    return total > 0 ? STATUS.WIKI_HAS_COMMIT : STATUS.WIKI_EXIST;
  }
  if (isSuccess(stored)) return stored;
  if (DRIFT_STATUSES.includes(stored)) return stored;
  return total > 0 ? STATUS.WIKI_EXIST : STATUS.WIKI_INIT;
}

/**
 * The `wiki.pre.*` heading Qoder shows instead of the idle state.
 *
 * Mirrors `Ngo`/`EPl`/`SPl`: when the backend reports a precondition
 * `server_error_code` while the wiki is still at `WIKI_INIT`, the panel swaps
 * the welcome copy for a dedicated error view (`wiki.pre.indexing` gets a
 * friendly title; every other `wiki.pre.*` code displays itself).
 * @param {string} [status]
 * @param {object} [details]
 * @returns {{ title: string, desc: string } | null}
 */
export function serverErrorView(status, details) {
  if (status !== STATUS.WIKI_INIT && !(status === undefined || status === null || status === '')) return null;
  const code = typeof details?.server_error_code === 'string' ? details.server_error_code : '';
  if (!code.startsWith('wiki.pre.')) return null;
  return {
    title: code === 'wiki.pre.indexing' ? 'Indexing in Progress' : code,
    desc: code === 'wiki.pre.indexing' ? 'Indexing, please wait' : '',
  };
}

/**
 * A UI tone for a status, so the client does not re-derive colour rules.
 * @param {string} [status]
 * @returns {'ok'|'warn'|'err'|'muted'|'brand'}
 */
export function statusTone(status) {
  if (isSuccess(status)) return 'ok';
  if (isFailed(status)) return 'err';
  if (isRunning(status)) return 'brand';
  if (status === STATUS.PAUSED) return 'warn';
  if (hasDrift(status)) return 'warn';
  return 'muted';
}
