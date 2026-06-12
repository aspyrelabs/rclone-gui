# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository is **rclone GUI** — a self-hostable web GUI for [rclone](https://rclone.org), deployable as a single Docker container. It consumes rclone purely as a compiled binary over rclone's remote-control (rc) HTTP API; it does **not** contain or modify rclone's Go source. (This tree was originally forked from the rclone source, which was removed in the first implementation commit.)

## Project status

Built in stages (see `docs/superpowers/specs/2026-06-11-rclone-gui-stage-1-design.md`):

- **Stage 1 — Remotes & Configuration: COMPLETE** (plans under `docs/superpowers/plans/`).
  - Plan 1 — Backend & rclone integration (Fastify API + supervised `rclone rcd`).
  - Plan 2 — Frontend (React + Vite SPA: app shell, auto-generated config wizard, dashboard, optional-auth gate).
  - Plan 3 — Packaging (multi-stage Dockerfile, pinned rclone) & runtime version self-updater + Settings UI.
- **Stage 2 — Browse & Basic Operations: COMPLETE.**
  - Plan A — Backend: `BrowseService` (list/mkdir/delete) + `JobService` (async copy/move with live `job/status` + `core/stats`, stop) and their endpoints.
  - Plan B — Frontend: file browser (navigate/mkdir/delete), transfer dialog (copy/move to a destination), and a polling Jobs page (progress + stop). Browse/Jobs nav enabled.
- **Stage 3 — Serve & Mounts: COMPLETE.**
  - Plan A — Backend: `ServeService` (start/list/stop/types over `serve/*`) + `MountService` (mount/list/unmount/types over `mount/*`) and their endpoints.
  - Plan B — Frontend: Serve page (start/list/stop, address linkified) + Mounts page (mount/list/unmount + FUSE-privileges note). Serve/Mounts nav enabled.
- **Stage 4 — Scheduling & Automation: COMPLETE.**
  - Plan A — Backend: `ScheduleStore` (persists `schedules.json`), `node-cron`-backed `Scheduler` (injectable cron) firing `JobService.launch`, `ScheduleService` (CRUD + run-now), endpoints; scheduler reloaded from disk at startup.
  - Plan B — Frontend: Schedules page (create/edit/delete/toggle/run-now, cron presets, last-run status). Schedules nav enabled (all "soon" items now live).
- **Stage 5 — Polish (scoped): COMPLETE.**
  - Plan A — Backend: global bandwidth limit (`core/bwlimit`) service + endpoints; capped per-schedule run history in `ScheduleStore`.
  - Plan B — Frontend: bandwidth controls in Settings; expandable run-history on the Schedules page.
- **All roadmap stages complete.** Remaining optional enhancements (not yet built): notifications on failure, multi-user auth, persisted bwlimit across restarts, missed-run backfill.

## Commands

npm workspaces monorepo (`server`, `web`). Node 20+.

```bash
npm install                       # install all workspace deps
npm run fetch-rclone              # download + SHA256-verify pinned rclone (v1.74.3) into ./.rclone/ (needed for server tests)
npm --workspace server run test   # backend test suite (Vitest; spawns a real rclone rcd)
npm --workspace web run test      # frontend test suite (Vitest + RTL; mocks the API)
npm --workspace web run build     # typecheck (tsc) + build the SPA to web/dist
npm --workspace server run dev    # backend in watch mode (tsx); serves :3000
npm --workspace web run dev       # Vite dev server; proxies /api -> :3000

# Run the whole thing as it ships (single container):
docker compose up -d --build      # http://localhost:3000  (or: docker build -t rclone-gui .)
```

Run a single test file: `npm --workspace server run test <name>` (e.g. `daemon`, `remotes-crud`) or `npm --workspace web run test <name>` (e.g. `RemoteWizard`).

Production-style local run without Docker: `WEB_ROOT="$PWD/web/dist" RCLONE_BINARY="$PWD/.rclone/rclone" RCLONE_GUI_CONFIG_DIR="$(mktemp -d)" node server/dist/index.js` (after building both workspaces) — the backend serves the built SPA and `/api/*`.

Useful dev env vars (see `server/src/config.ts`): `PORT`, `HOST`, `GUI_PASSWORD` (enables auth when set), `RCLONE_GUI_CONFIG_DIR` (default `/config`), `RCLONE_CONFIG`, `RCLONE_BINARY` (override the binary path — handy in dev: `RCLONE_BINARY="$(pwd)/.rclone/rclone"`).

## Architecture

### Backend (`server/`)

A single Node process supervises a child `rclone rcd` daemon, proxies a REST API to it, and serves the built SPA.

- `src/rclone/daemon.ts` — `RcloneDaemon`: spawns `rclone rcd` bound to `127.0.0.1` on a random free port with random HTTP Basic-Auth creds (never exposed outside the process); waits on `rc/noop`; auto-restarts with capped backoff; `stop()` does SIGTERM→SIGKILL.
- `src/rclone/client.ts` — `RcClient.call<T>(rcPath, params)`: authenticated POST to the daemon; maps rc failures to a thrown `RcError(message, status, path)`.
- `src/rclone/providers.ts` / `remotes.ts` — services over `RcClient`: `config/providers` (cached) and remote CRUD (`config/listremotes`, `config/dump`, `config/create`/`update`/`delete`) plus a connectivity `test` (`operations/about` → `operations/list` fallback). The interactive `config/create` state-machine (`continueConfig`) is exposed so OAuth backends work through the same path.
- `src/rclone/types.ts` — the rc option/provider shapes (`RcOption` carries `Help`, `DefaultStr`, `Examples`, `Required`, `Advanced`, `IsPassword`, `Sensitive`, `Provider`, `Groups`). The frontend (Plan 2) will auto-generate config forms from these — options are never hardcoded.
- `src/rclone/version.ts` — `VersionService` (injectable deps): reports installed vs latest rclone (GitHub releases API) and self-updates by running `scripts/fetch-rclone.sh` into `<configDir>/bin`, then `daemon.restart()` + `providers.invalidate()`. The daemon resolves its binary on every `start()`, so an update takes effect on restart.
- `src/rclone/browse.ts` / `jobs.ts` (Stage 2) — `BrowseService` (list/mkdir/deletePath via `operations/*`, fs string = `"remote:path"`) and `JobService` (async `sync/copy`·`sync/move` for dirs, `operations/copyfile`·`movefile` for files, all with a generated `_group`; `list()` merges `job/status` + `core/stats`; in-memory job registry, process-lifetime).
- `src/rclone/serve.ts` / `mounts.ts` (Stage 3) — `ServeService` (`serve/types|start|list|stop`) and `MountService` (`mount/types|mount|listmounts|unmount`). Serve/mount instances live in the `rcd` process; mounts need host FUSE/privileges.
- `src/schedules/` (Stage 4) — `ScheduleStore` (persists `<configDir>/schedules.json`, atomic), `Scheduler` (registers a cron task per enabled schedule via an injectable `Cron` interface defaulting to `node-cron`; on fire calls `JobService.launch` and records `lastRun/lastJobId/lastError`), `ScheduleService` (CRUD + `runNow` + cron validation). Bootstrap loads the store then `scheduler.reload()`. Missed runs while down are not back-filled; times use the container TZ.
- `src/routes/*` — thin Fastify route plugins: `/api/health`, `/api/providers`, `/api/remotes` (+ `:name/continue`, `:name/test`), `/api/version` (+ `/update`), `/api/browse` (+ `/mkdir`, `/delete`), `/api/jobs` (+ `:id/stop`), `/api/serve` (+ `/types`, `:id/stop`), `/api/mounts` (+ `/types`, `/unmount`), `/api/schedules` (+ `:id`, `:id/run`), `/api/bwlimit` (get/set; Stage 5), and `static.ts` (serves `WEB_ROOT` with an SPA history-fallback that never shadows `/api/*`).
- `src/auth/gate.ts` — optional auth: when `GUI_PASSWORD` is set, a signed-cookie session gates `/api/*` (except health/auth); when unset, open mode and `/api/auth/status` reports `protected:false`.
- `src/app.ts` — `buildApp(deps)`: composes cookie plugin, an `RcError`→`{error,status}` error handler, the auth gate, the api routes, then static. No `listen` (so tests use `app.inject`).
- `src/index.ts` — bootstrap: resolver thunk, start daemon, build app (incl. VersionService + webRoot), SIGINT/SIGTERM shutdown, listen. Guarded so importing it doesn't start a server.

### Frontend (`web/`) — React 18 + Vite SPA

- `src/api/client.ts` + `types.ts` — typed `fetch` wrapper (`ApiError`) and shared types mirroring the backend.
- `src/wizard/optionVisibility.ts` + `components/OptionField.tsx` — **the core**: render any rclone `RcOption` as the right control (bool/select/suggest/password/number/text) with tooltip (`Help`) and default (`DefaultStr`); `partitionOptions`/`matchesProvider` handle basic-vs-advanced split and provider-conditional fields. Options are never hardcoded.
- `src/wizard/RemoteWizard.tsx` — 4-step add/edit wizard (type → basic → advanced → save) with a generic pending/continue step for OAuth/interactive backends.
- `src/pages/` — `RemotesPage` (dashboard: cards, test/delete, add), `SettingsPage` (rclone version + update), `BrowsePage` (Stage 2: remote picker, breadcrumb, mkdir/delete, copy/move actions), `JobsPage` (Stage 2: polling progress + stop), `ServePage` (Stage 3: start/list/stop serves), `MountsPage` (Stage 3: mount/list/unmount + FUSE note), `SchedulesPage` (Stage 4: cron schedule CRUD/toggle/run-now). `components/AppShell` (sidebar nav) + `AuthGate` (login / unprotected banner) + `TransferDialog` (copy/move destination). `hooks/useJobs` polls `/api/jobs` (~1.5s) while mounted.
- Dev: Vite proxies `/api` → `:3000`. Prod: the backend serves `web/dist` (`WEB_ROOT`).

### Packaging

Multi-stage `Dockerfile`: fetch+verify pinned rclone (alpine) → build SPA + server (node) → slim runtime (`node server/dist/index.js`, serving `/api/*` + SPA, supervising `rcd`). `docker-compose.yml` maps `:3000` and a `/config` volume. `RCLONE_BINARY` is intentionally unset in the image so the resolver prefers a self-updated `/config/bin/rclone`.

## Conventions

- **ESM TypeScript:** `"type": "module"`; use `.js` import specifiers in `.ts` source (e.g. `import { x } from "./foo.js"`). In tests/helpers derive paths from `import.meta.url` (`fileURLToPath`), **not** `__dirname` (undefined under ESM).
- **Tests are real integration tests:** they spawn an actual `rclone rcd` (via `test/helpers/rcd.ts`) and exercise the real rc API against rclone's `local`/`memory` backends — no cloud credentials needed. Always ensure the test's `afterAll`/`afterEach` calls `daemon.stop()` so no `rcd` process leaks (check with `pgrep -fl "rclone rcd"`).
- **rclone is bundled, not built:** the pinned version (`v1.74.3`, latest published release) is downloaded + checksum-verified by `scripts/fetch-rclone.sh`. The binary is resolved at runtime in priority order: explicit `RCLONE_BINARY` → `<configDir>/bin/rclone` (self-updater target, Plan 3) → `./.rclone/rclone` (dev) → `rclone` on PATH.
- **Config persistence:** rclone's config lives at `<configDir>/rclone.conf` (default `/config/rclone.conf`), the same format the rclone CLI uses.
- Planning/spec docs live under `docs/superpowers/`; the visual-companion working dir `.superpowers/` is git-ignored.
