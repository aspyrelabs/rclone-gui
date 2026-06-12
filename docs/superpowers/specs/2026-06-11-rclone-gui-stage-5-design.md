# rclone GUI — Stage 5 Design (Polish: Bandwidth Limit & Run History)

**Date:** 2026-06-11
**Status:** Approved-by-delegation design (adjust on review)
**Scope:** The two highest-value, self-contained polish items. Builds on Stages 1–4 (complete, merged, pushed). Notifications and multi-user auth remain explicitly deferred (larger, decision-heavy).

## Summary

Two small, independent enhancements:
1. **Global bandwidth limit** — view and set rclone's live transfer bandwidth limit via `core/bwlimit`, surfaced in Settings.
2. **Schedule run history** — keep a capped per-schedule history of recent runs (time + job id or error) and show it on the Schedules page.

Both fit the existing architecture (thin rc proxy for bwlimit; an additive change to the Stage 4 `ScheduleStore` for history).

## Decisions

1. **Bandwidth limit is global**, applied immediately via `core/bwlimit {rate}` (e.g. `"1M"`, `"512k"`, `"off"`). It affects all transfers in the rcd process. Not persisted by the GUI (rclone holds it for the process lifetime); a later enhancement could persist + re-apply on startup. The Settings page shows the current rate.
2. **Run history lives on the schedule** (capped to the **last 20** runs) inside `schedules.json`, appended in `ScheduleStore.recordRun`. Returned with the schedule list (small payload), shown as an expandable view per row. No separate history store/endpoint.

## Verified rc shape (rclone v1.74.3)
- `core/bwlimit` → `{ rate: string, bytesPerSecond: number, bytesPerSecondRx: number, bytesPerSecondTx: number }`. With `{}` it returns the current limit; with `{rate}` it sets and returns the new one (`"1M"` normalizes to `"1Mi"`; `"off"` → `bytesPerSecond: -1`).

## Architecture (additions)

### Backend (`server/src`)
- `rclone/bwlimit.ts` — `BwLimitService`: `get()` and `set(rate)` over `core/bwlimit`.
- `routes/bwlimit.ts` — `GET /api/bwlimit`, `POST /api/bwlimit {rate}`.
- `schedules/store.ts` — add `RunRecord` + `Schedule.history: RunRecord[]`; `recordRun` prepends a record and caps at 20. (Backward compatible: schedules loaded without `history` default to `[]`.)
- Wire bwlimit into `buildApp`/bootstrap.

### Frontend (`web/src`)
- `api` — `BwLimit` + `RunRecord` types; `bwlimit()`, `setBwlimit(rate)` methods; add `history?: RunRecord[]` to `Schedule`.
- `pages/SettingsPage.tsx` — add a "Bandwidth limit" section (shows current rate; input + Apply; "off" disables).
- `pages/SchedulesPage.tsx` — add a "History" toggle per row showing recent runs (time · job N / error).

## Plan split
1. **Plan A — Backend:** bwlimit service+routes+wiring (live `rcd` tests); run-history store change (unit test).
2. **Plan B — Frontend:** bwlimit Settings section + run-history UI (mocked-API tests).

## Testing strategy
- **bwlimit:** live `rcd` — GET default (`off`), POST `"1M"` → reflected, POST `"off"` → disabled.
- **history:** `ScheduleStore` unit test — multiple `recordRun`s append records (newest first), cap at 20, mixed success/error.
- **frontend:** mocked API — Settings shows/sets the rate; Schedules row expands to show history.

## Risks / notes
- bwlimit is process-global and not persisted by the GUI (documented). 
- History grows `schedules.json` slightly (≤20 records/schedule); negligible.

## Out of scope (remaining, optional)
Notifications (webhook on failure), multi-user auth, missed-run backfill, persisted bwlimit across restarts.
