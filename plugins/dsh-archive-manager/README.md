# dsh-archive-manager

Archive manager plugin for DeepSeek Harness (DSH): an archive box entry with a
live count badge in the sidebar footer, a manager dialog to **restore**
(unarchive) archived sessions, a **soft-delete** recycle bin, and an opt-in
**physical delete** (recycle bin for session log files).

## Features

- **Live count badge** — the sidebar footer entry (`sidebar.footer.action`
  slot) shows the archived-session count, subscribed through the root-scope
  `useWorkspaces` selector, so it updates across tabs whenever
  `host/archived-sessions-changed` arrives.
- **Restore (unarchive)** — removes ids from the registry-global archive set
  through the registry's own serialized operation queue, so sessions reappear
  in their original workspace position.
- **Real session titles** — the archive list shows the durable session title
  (the same title the sidebar shows): live sessions read the folded title
  from `ctx.sessionTitle`; cold sessions read the zero-I/O `title` projection
  checkpoint from `ctx.sessionProjectionCache`; sessions without any title
  fall back to the cwd basename.
- **Delete (soft, default)** — records a durable tombstone in plugin
  settings; the session stays in the archive set (hidden from every grouping
  surface) and disappears from this plugin's list. Restorable from the
  "已删除" tab.
- **Physical delete (opt-in `physicalDelete: true`)** — moves the session's
  log artifact into a plugin-owned trash directory (reversible), removes the
  id from the archive set, and shows it in the "物理回收站" tab where it can
  be **恢复** (moved back) or **销毁** (irreversible unlink).
- **Search & filter** — filter by title or workspace; select-all and batch
  restore / delete / physical-delete / destroy. Debounced input with a clear
  button; long lists render incrementally (50 per page) with a "load more"
  hint, so hundreds of archived sessions stay smooth on phones.
- **Mobile responsive** — the dialog becomes a bottom sheet under 768px with
  safe-area padding, larger touch targets (22px checkboxes, full-row tap to
  toggle selection, 16px search input to prevent iOS focus zoom, single-line
  truncated metadata), and a `window.__dsh_open_archive_manager`
  global plus `dsh:open-archive-manager` window event for host-shell entry
  points (e.g. the mobile tools menu).

## Physical deletion: how it works and its boundaries

DSH core has **no physical session-deletion API** (no session-delete RPC, no
`delete(id)` on the persistence service). This plugin implements it directly
against the real storage contract instead:

1. `sessionPersistence.locate(header)` (public API) resolves the **absolute
   path** of the session's backend-owned artifact (JSONL backend:
   `logPath(root, cwd, id, compression)`).
2. A session that is **live** (present in `ctx.get('sessions')`) is refused —
   its event stream is backed by the artifact and moving the file under a
   live writer would corrupt the log.
3. The artifact is **moved** (`rename`) into the trash directory —
   `<dsh-home>/archive-manager/trash` by default, overridable with
   `trashDir` — never unlinked, so the operation is reversible and the
   persistence coordinator never observes a vanished file it still expects.
4. The id is removed from the archive set through the registry operation
   queue, and a `physical` tombstone is stored in plugin settings.

Why the system stays coherent:

- `sessionPersistence.list()` is **disk-backed**, so a moved artifact
  disappears from listings immediately; the SQLite search index
  (`dsh-session-query-sqlite`) self-heals by deleting vanished sessions on
  its next observation cycle.
- Workspace durable accounting keeps a (display-filtered) dangling id; when
  the artifact is restored, the session's header index picks it up again and
  the session reappears in its original workspace — note this re-indexing
  happens at the next daemon start (or the next archive-set operation), not
  instantly.

Known boundaries:

- **Attachments referenced by the log are NOT deleted** — shared images may
  be referenced by other sessions; deleting them could break other logs.
- A session in the trash must not be resumed; the UI hides it, but a manual
  `prepare`/`load` on its id would fail with a missing-file error.
- Restore is a file move; if the original directory was removed, it is
  recreated.

### Why not bash / PowerShell (computer control)?

The sandboxed shell services (`dsh-bash-sandbox` / `dsh-pwsh-sandbox`)
confine `workspace-write` to the workspace root + tmp. Session logs live
under the DSH home (`~/.dsh/...`), **outside** that root, so `rm` /
`Remove-Item` would be denied unless escalated to `danger-full-access` (an
approval flow). And shelling out adds quoting/injection and platform
branches for zero benefit: the plugin host process already runs outside the
sandbox with direct Node fs access, which is what `deletePhysical` uses.

## Real DSH contracts used

- Host RPC: `ctx.inject(['connection'], ...)` + `connection.rpc.handle('/dsh-archive-manager-rpc', (method, payload) => ..., { authority: 'trusted-host' })`; client calls `ctx.connection.rpc.call('/dsh-archive-manager-rpc', method, payload)` and unwraps the `{ ok, value }` envelope.
- Archive set: `ctx.workspaceRegistry.archivedSessionIds` (read) and `archiveSession(id)` (add) are the only public surface. **DSH core ships no unarchive API**, so restore reaches the registry's runtime-visible private `enqueueOperation` / `requireState` / `setState` (feature-detected; a version mismatch fails loud instead of silently no-oping).
- Artifact paths: `ctx.sessionPersistence.locate(header)`; metadata: `list()` (disk-backed headers, no full-log reads).
- Titles: `ctx.sessionTitle.get(session)` for live sessions; `ctx.sessionProjectionCache.cachedSnapshot(header).values.title` (the `session-title` projection unit's `title` key, string | null) for cold sessions — both read without loading the log.
- Tombstones + options persist in plugin settings (`settings.register('archive-manager', ...)`, `scope.update` / `scope.replace`).
- Trash directory default via `@deepseek-ai/dsh-home-paths` (`<dsh-home>/archive-manager/trash`).

## Configuration (`settings` / settings.yaml)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `physicalDelete` | boolean | `false` | Enable physical delete (trash-directory recycle bin) |
| `trashDir` | string | `''` | Custom trash directory; empty = `<dsh-home>/archive-manager/trash` |
| `tombstones` | array | `[]` | Durable soft/physical delete records (managed by the plugin) |

## RPC methods

| Method | Payload | Returns |
| --- | --- | --- |
| `list` | `{}` | archived summaries (tombstones filtered) |
| `deleted` | `{}` | soft + physical tombstone summaries |
| `capabilities` | `{}` | `{ physicalDelete, trashDir }` |
| `unarchive` | `{ sessionIds }` | `{ unarchivedIds }` |
| `delete` | `{ sessionIds }` | `{ deletedIds }` |
| `restoreDeleted` | `{ sessionIds }` | `{ restoredIds }` |
| `deletePhysical` | `{ sessionIds }` | `{ moved, skipped }` (requires `physicalDelete`) |
| `restorePhysical` | `{ sessionIds }` | `{ restoredIds }` (requires `physicalDelete`) |
| `destroyPhysical` | `{ sessionIds }` | `{ destroyedIds }` (requires `physicalDelete`) |

## Development

```bash
pnpm install
npm test        # node --test test/*.test.mjs
npm pack        # produces dsh-archive-manager-<version>.tgz
# deploy per repo policy: dsh plugin add --profile web ./dsh-archive-manager-<version>.tgz
```

## License

MIT
