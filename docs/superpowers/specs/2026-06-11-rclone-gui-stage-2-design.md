# rclone GUI — Stage 2 Design (Browse & Basic Operations)

**Date:** 2026-06-11
**Status:** Approved-by-delegation design (user delegated decisions; adjust on review)
**Scope:** Stage 2 of the staged roadmap. Builds on Stage 1 (Remotes & Configuration), which is complete and merged.

## Summary

Add the ability to **browse** a configured remote's files and run **basic operations** on them — create folder, delete, and copy/move a path to another remote+path — with **live transfer progress** and a jobs panel. This turns the GUI from "configure remotes" into "actually move data around."

Like Stage 1, the backend is a thin, typed proxy over rclone's rc API; no rclone behavior is reimplemented.

## Decisions (made under delegation — flag any to change)

1. **Live progress = REST polling, not WebSocket.** The Stage 1 architecture sketch mentioned a `/ws` channel, but for a first version REST polling is simpler, fully testable, and robust: the UI polls `GET /api/jobs` (~1s) only while at least one job is running, and stops when idle. A WebSocket push channel can replace polling later as an optimization. **(Deviation from the original sketch — intentional.)**
2. **Browse is single-remote, directory-at-a-time.** Navigate into one remote, one directory level at a time (`operations/list` with a `remote` path), with a breadcrumb. No global cross-remote tree.
3. **Operations in scope:** create folder, delete (file or directory), and **copy/move a path to a destination** (any remote + path). Move-to with the same remote and a new name covers rename. Directory transfers run as async jobs; single-file copy/move use the synchronous `operations/copyfile`/`movefile`.
4. **Out of scope for Stage 2:** uploading local files through the browser, drag-and-drop, multi-select bulk ops, in-place file preview/editing, server-side-only optimizations toggles. (Candidates for later polish.)
5. **Jobs are process-lifetime only.** The backend keeps an in-memory registry of jobs it launched (jobid → metadata); it is not persisted across restarts. rclone's own `job/list` is the source of truth for status.

## Endpoints this stage relies on (verified against rclone v1.74.3)

- `operations/list {fs, remote, opt}` → `{ list: [{ Path, Name, Size, ModTime, IsDir, MimeType }] }`
- `operations/mkdir {fs, remote}`
- `operations/deletefile {fs, remote}` (single file) · `operations/purge {fs, remote}` (dir + contents) · `operations/rmdir {fs, remote}` (empty dir)
- `operations/copyfile {srcFs, srcRemote, dstFs, dstRemote}` · `operations/movefile {…}` (single files)
- `sync/copy {srcFs, dstFs, _async:true, _group}` · `sync/move {…}` → `{ jobid }` (directory transfers)
- `job/status {jobid}` → `{ finished, success, error, … }` · `job/list` → `{ jobids, runningIds, finishedIds }` · `job/stop {jobid}`
- `core/stats {group}` → `{ bytes, totalBytes, transfers, totalTransfers, speed, eta, errors, … }`

The rc `fs` value for a configured remote named `X` is `"X:"`; a path inside it is the `remote` parameter (e.g. `"sub/dir"`).

## Architecture (additions to Stage 1)

All additions are new modules; nothing in Stage 1 is restructured.

### Backend (`server/src`)
- `rclone/browse.ts` — `BrowseService` over `RcClient`: `list(remote, path)` → typed entries; `mkdir`, `deletePath` (chooses `deletefile` vs `purge`/`rmdir` based on whether the target is a dir).
- `rclone/jobs.ts` — `JobService`: launches a copy/move (single-file sync endpoints, or async `sync/copy`/`sync/move` for directories) recording `{ jobid, type, src, dst, group }` in an in-memory registry; `list()` merges the registry with live `job/status` + grouped `core/stats`; `stop(jobid)`.
- `routes/browse.ts` — `GET /api/browse?remote=&path=`, `POST /api/browse/mkdir`, `POST /api/browse/delete`.
- `routes/jobs.ts` — `POST /api/jobs` (launch copy/move), `GET /api/jobs`, `POST /api/jobs/:id/stop`.
- Wired into `buildApp`/bootstrap exactly like the Stage 1 services (sharing the one `RcClient`).

### Frontend (`web/src`)
- `api` — new client methods + types (`DirEntry`, `JobInfo`).
- `pages/BrowsePage.tsx` — remote picker + breadcrumb + entries table (folder rows navigate; file rows show size/modtime); toolbar: New folder, and per-row Delete / Copy-to / Move-to.
- `components/TransferDialog.tsx` — choose destination remote + path for copy/move; launches a job.
- `components/JobsPanel.tsx` — a dock/panel listing active+recent jobs with progress (%, bytes/total, speed, eta), polling `GET /api/jobs` while any job runs; Stop button.
- Sidebar: enable the **Browse** and **Jobs** items (previously "soon").

## Likely plan split

1. **Plan A — Backend:** browse + jobs services, endpoints, wiring, tests (real `rcd`, `local`/`memory` backends, real async jobs).
2. **Plan B — Frontend:** browse page, transfer dialog, jobs panel + polling, sidebar enablement, tests (mocked API).

## Testing strategy

- Backend: integration tests against a real `rcd` — list a temp dir, mkdir, delete, and run an actual `sync/copy` between two temp dirs, asserting the job appears and reaches `finished/success` with stats. No cloud creds.
- Frontend: component tests with a mocked API client (browser navigation, launching a transfer, jobs-panel progress rendering, polling start/stop).

## Risks / notes

- **Polling cadence:** 1s while active, paused when idle, to avoid hammering the backend. Documented and adjustable.
- **Large directory listings:** Stage 2 lists a single directory level (not recursive), so listings stay bounded; pagination is a later concern if needed.
- **Destructive delete:** the UI confirms before `purge` (recursive) and labels it clearly.
- **Job registry loss on restart:** acceptable for Stage 2; rclone keeps running jobs server-side and `job/list` still reports them, though our per-job metadata (src/dst labels) is lost on restart.

## Out of scope (later stages)
Mounts/serve (Stage 3), scheduling (Stage 4), bandwidth limits/notifications/multi-user (Stage 5).
