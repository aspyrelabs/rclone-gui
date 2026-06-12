# rclone GUI — Stage 4 Design (Scheduling & Automation)

**Date:** 2026-06-11
**Status:** Approved-by-delegation design (adjust on review)
**Scope:** Stage 4 of the roadmap. Builds on Stages 1–3 (complete, merged, pushed).

## Summary

Let users save copy/move transfers and run them automatically on a **cron schedule**. A schedule names a source and destination (the same `PathRef` shape Stage 2 uses) plus a cron expression; the backend persists schedules and runs a background scheduler that launches the corresponding job (via the existing `JobService`) when each fires. The Schedules page manages them and shows last-run status; "Run now" triggers immediately.

## New infrastructure (the consequential decisions)

Unlike Stages 1–3 (thin rc proxies), Stage 4 adds state the GUI itself owns:

1. **Persistence = a JSON file on the config volume**: `<configDir>/schedules.json` (next to `rclone.conf`). Simple, transparent, survives container restarts and is easy to back up/inspect. No database. Writes are atomic (temp file + rename).
2. **Scheduler = `node-cron`** (small, widely used, validates cron expressions) wrapped behind an injectable interface so it can be faked in tests (no waiting on real time). On startup the backend loads `schedules.json` and registers a cron task per enabled schedule; on fire it calls `JobService.launch(...)` and records the result back to the store.
3. **Run tracking = last-run summary on each schedule** (`lastRun` timestamp, `lastJobId`, `lastError`), not a full history log. A full run-history log is deferred (YAGNI for v1); the Jobs page already shows live/recent jobs.
4. **Timestamps are injected** (a `now()` provider) so the store/scheduler are deterministic in tests.

## Data model

```ts
interface Schedule {
  id: string;            // generated
  name: string;
  type: "copy" | "move";
  isDir: boolean;
  src: { remote: string; path: string; name: string };
  dst: { remote: string; path: string; name: string };
  cron: string;          // e.g. "0 3 * * *"
  enabled: boolean;
  lastRun?: string;      // ISO timestamp
  lastJobId?: number;
  lastError?: string;
}
```

## Architecture (additions)

### Backend (`server/src`)
- `schedules/store.ts` — `ScheduleStore`: load/save `schedules.json` (atomic), CRUD on the in-memory array, injectable file path + `now()`.
- `schedules/scheduler.ts` — `Scheduler`: given the store + a `JobService` + an injectable `cron` interface (`schedule(expr, fn) → { stop() }`, `validate(expr)`), (re)registers tasks for enabled schedules; `fire(id)` launches the job and writes back `lastRun/lastJobId/lastError`; `reload()` re-syncs tasks after CRUD.
- `schedules/service.ts` — `ScheduleService`: CRUD (create/list/update/delete) that persists via the store and calls `scheduler.reload()`; `runNow(id)` calls `scheduler.fire(id)`.
- `rclone/cron.ts` (or inline) — the default `cron` implementation backed by `node-cron`.
- `routes/schedules.ts` — `GET /api/schedules`, `POST /api/schedules`, `PUT /api/schedules/:id`, `DELETE /api/schedules/:id`, `POST /api/schedules/:id/run`.
- Wired into `buildApp`/bootstrap; the scheduler starts after the daemon + `JobService` exist.

### Frontend (`web/src`)
- `api` — `Schedule` type + methods (`schedules`, `createSchedule`, `updateSchedule`, `deleteSchedule`, `runSchedule`).
- `pages/SchedulesPage.tsx` — table (name, `src → dst`, cron, enabled toggle, last run + status) with Run-now / Edit / Delete; a create/edit form (name, copy/move, src remote+path, dst remote+path, isDir, cron text + a few presets, enabled).
- Sidebar: enable the **Schedules** nav item (the last "soon").

## Endpoints relied on
Reuses Stage 2 `JobService.launch(LaunchInput)` (no new rc calls). `node-cron` is a new npm dependency in `server`.

## Plan split
1. **Plan A — Backend:** store + scheduler (injectable cron) + service + routes + wiring; tests with a fake cron + temp file (deterministic, no real-time waits), and a real `JobService` against a real `rcd` for the fire→launch path.
2. **Plan B — Frontend:** Schedules page + nav, tests (mocked API).

## Testing strategy
- **Store:** load/save round-trip to a temp file; missing file → empty list; atomic write.
- **Scheduler/Service:** inject a fake cron that records registered expressions and lets the test invoke the fire callback synchronously; assert `runNow`/fire calls `JobService.launch` with the schedule's `LaunchInput` and records `lastJobId`. Use a real `JobService` + `rcd` + `local` backend so the launched job is real; assert the schedule's `lastJobId` is set and the (server-side) copy completes. Invalid cron → rejected by `cron.validate`.
- **Frontend:** component tests with a mocked API client (list, create, run-now, enable/disable, delete).

## Risks / notes
- **Missed fires while the container is down** are not back-filled (cron only fires when running). Documented; acceptable for v1.
- **Timezone:** `node-cron` uses the container's local time (UTC by default in the image). The Schedules page notes this; a per-schedule timezone is a later enhancement.
- **Concurrent fires / overlap:** if a schedule fires while its previous job is still running, both run (rclone handles concurrent jobs). Overlap guarding is deferred.
- **Persistence file corruption:** load tolerates a missing/empty file (→ empty list); a malformed file surfaces an error at startup rather than silently dropping schedules.

## Out of scope (Stage 5)
Bandwidth limits, notifications (e.g. on schedule failure), multi-user, full run-history log, back-filling missed runs, per-schedule timezones.
