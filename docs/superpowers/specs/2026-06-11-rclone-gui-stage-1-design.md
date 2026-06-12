# rclone GUI — Stage 1 Design (Remotes & Configuration)

**Date:** 2026-06-11
**Status:** Approved design, ready for implementation planning
**Scope:** Stage 1 of a staged roadmap (see below). This document fully specifies Stage 1 only.

## Summary

A self-hostable web GUI for [rclone](https://rclone.org), deployable as a single Docker
container (Unraid / Portainer / `docker run` friendly). The defining goal: **every rclone
configuration option is available in the UI, each with a tooltip describing what it does and
its appropriate default** — achieved without hand-coding options, by introspecting rclone's
own self-describing configuration at runtime.

The GUI consumes rclone as a compiled binary over its remote-control (rc) HTTP API. It does
**not** modify rclone's source code.

## Staged roadmap (context, not all in scope)

The product is built in independently useful stages. Only **Stage 1** is designed here; later
stages get their own spec → plan → implementation cycle.

1. **Stage 1 — Remotes & Configuration** *(this document)*: create / edit / delete / test
   remotes across all backends via auto-generated forms.
2. **Stage 2 — Browse & basic operations**: file browser; copy/sync/move/delete between
   remotes with live progress and a job list.
3. **Stage 3 — Mounts & serve**: manage `rclone mount` and `rclone serve` instances.
4. **Stage 4 — Scheduling & automation**: saved jobs, cron scheduling, run history.
5. **Stage 5 — Polish & ops**: bandwidth limits, notifications, multi-user, settings depth.

## Technology stack

- **Backend:** Fastify (TypeScript) — REST under `/api/*`, WebSocket at `/ws`.
- **Frontend:** React + Vite single-page app (TypeScript), built to static assets and served
  by Fastify.
- **rclone:** official pinned release binary, bundled into the image at build time; talked to
  over its rc HTTP API.
- **Packaging:** one Docker image, one Node process, exposes `:3000`, persists to `/config`.

Decision rationale: one language end-to-end (TypeScript), fast UI iteration, first-class
WebSocket support for live progress, and a simple single-process model that is easy to keep
correct.

## Architecture

```
┌─ Docker container ───────────────────────────────────┐
│                                                       │
│  Fastify server (TypeScript)          rclone binary   │
│  ┌──────────────────────┐            ┌────────────┐   │
│  │ /api/*  REST          │  HTTP +    │ rclone rcd │   │
│  │ /ws     WebSocket     │◄──token───►│  (rc API)  │   │
│  │ serves built SPA      │  127.0.0.1 │ localhost  │   │
│  └──────────┬───────────┘            │ only       │   │
│             │ spawns + supervises ───►└─────┬──────┘   │
│  React+Vite SPA (static)                    │          │
│                                       reads/writes     │
│                                       /config/rclone.conf
└───────────────────────────────────────────────────────┘
        ▲                                      ▲
        │ :3000 (UI + API)            volume: /config
     browser                          (rclone.conf + bin)
```

### How the GUI talks to rclone — supervised child `rcd`

On startup the Fastify server spawns rclone as a daemon:

```
rclone rcd --rc-addr 127.0.0.1:<random-port> \
           --rc-user <random> --rc-pass <random> \
           --config /config/rclone.conf
```

- The daemon is **bound to localhost inside the container only** and is **never exposed**
  outside it. Only the Fastify process holds the credentials and proxies to it.
- Fastify supervises the child: restarts it if it dies, and restarts it after an rclone binary
  update (see below).
- All rclone functionality is reached through authenticated HTTP calls to this daemon.

Rejected alternatives: **librclone (in-process FFI)** — fragile native bindings, hard to keep
error-free; **sidecar container** — breaks the single-container deployment goal.

### rclone binary lifecycle

- **Build time:** the Dockerfile downloads a **pinned rclone release** from GitHub and
  **verifies its SHA256** before baking it into the image. A fresh container therefore always
  has a known-good binary, even with no network access.
- **Runtime updater (a `version` service in the backend):**
  1. Reads the installed version via `rclone version`.
  2. Polls the GitHub releases API (`/repos/rclone/rclone/releases/latest`) on a schedule and
     on demand.
  3. Surfaces status in **Settings**: e.g. *"rclone v1.xx installed · v1.yy available ·
     [Update]"*.
  4. On update: downloads the correct OS/arch asset, **verifies SHA256SUMS** (GPG optional),
     atomically swaps the binary into a writable path on the `/config` volume
     (`/config/bin/rclone`, which is preferred over the image baseline when present and
     valid), then restarts the supervised `rcd` child.
  5. On any failure, falls back to the bundled pinned binary. Updates persist across container
     restarts because they live on the volume.

## The auto-generated configuration form engine (core of Stage 1)

No option is hand-coded. The UI is generated from rclone's self-description.

1. The backend calls rclone's `config/providers` to get every backend and its `Options[]`, and
   `options/info` for global option metadata. Results are cached and refreshed when the rclone
   binary version changes.
2. Each option's metadata maps directly to a rendered form field:

   | rclone option field            | Drives in the UI                                        |
   | ------------------------------ | ------------------------------------------------------- |
   | `Name`                         | field label                                             |
   | `Help`                         | **tooltip** (ⓘ)                                         |
   | `Default` / `DefaultStr`       | prefilled **default value** + "default: X" hint         |
   | `Examples`                     | dropdown choices                                        |
   | `Exclusive`                    | strict dropdown vs. free-text-with-suggestions          |
   | `Required`                     | required-field validation (`*`)                         |
   | `Advanced`                     | placed in the wizard's **Advanced** step                |
   | `Groups`                       | grouping/sectioning of advanced options                 |
   | `IsPassword` / `Sensitive`     | **masked** input                                        |
   | `Provider`                     | conditional show/hide (e.g. S3-compatible sub-providers)|
   | `Type` (from option JSON)      | control type: text / number / bool toggle / size / duration |

3. A single React `<OptionField>` component switches on `Type` + flags to render the correct
   control. This is the most heavily unit-tested unit in Stage 1.
4. **Provider-conditional logic:** for backends like S3 with a `provider` selector (AWS,
   MinIO, Cloudflare R2, …), each option's `Provider` filter is honored so only relevant
   fields are shown for the chosen provider.

**Net effect:** when a future rclone release adds a backend or option, the GUI renders it
automatically with no code change.

### Add/edit remote wizard (chosen flow)

A step-by-step wizard:

- **Step 1 — Type:** searchable list of backends; pick one. Enter the remote name (validated:
  required, unique, rclone-legal characters).
- **Step 2 — Basic:** required + non-advanced fields, each with tooltip and default.
- **Step 3 — Advanced:** advanced fields, grouped via `Groups`, collapsed by default.
- **Step 4 — Test & save:** run a connection test, then save.

Edit reuses the same wizard, prefilled from the existing remote.

## Stage 1 feature set and API

REST endpoints (Fastify) wrap rc calls:

| Feature                | UI                              | rc call(s)                          |
| ---------------------- | ------------------------------- | ----------------------------------- |
| List remotes + status  | Remotes dashboard (cards)       | `config/listremotes`, `config/get`  |
| Add remote             | Wizard                          | `config/create`                     |
| Edit remote            | Wizard (prefilled)              | `config/update`                     |
| Delete remote          | Card action + confirm dialog    | `config/delete`                     |
| Test connection        | "Test" action / wizard step 4   | `operations/about` or `operations/list` |
| List providers/options | (internal, powers the wizard)   | `config/providers`, `options/info`  |

- **Test connection** runs a lightweight read against the remote; the result drives a status
  dot (ok / untested / error). Progress and errors stream over WebSocket so slow or
  interactive backends give feedback.
- **OAuth backends** (Google Drive, Dropbox, …): `config/create` returns an authorization URL;
  the GUI presents/opens it to complete the token flow, then finalizes the remote.

### App shell / navigation

- Dark left sidebar: **Remotes** (active in Stage 1), with **Browse / Jobs / Mounts /
  Schedules** shown as disabled "soon" entries (placeholders for later stages), and
  **Settings** at the bottom.
- Main area: **Remotes dashboard** — remotes as cards showing name, backend type, key detail
  (e.g. region), status dot, and Edit · Test · Delete actions, plus an "+ Add remote" entry
  that launches the wizard.
- Visual polish (colors, spacing) is intentionally deferred; the layout/structure is fixed,
  the styling can be refined later.

## Authentication & security

- **Optional auth, off by default.**
  - If `GUI_PASSWORD` is set: a cookie/session login gate protects both the UI and the API.
  - If unset: the app is open, and the UI shows a persistent **"⚠ running unprotected"**
    banner.
- The rclone rc daemon is **never exposed** outside the container; only the Fastify process
  reaches it, with random per-start credentials.
- Rationale: the rc API is shell-equivalent in power, so unprotected exposure is dangerous —
  but a frictionless local trial is still possible.

## Persistence & deployment

- **Config volume `/config`:** holds `rclone.conf` (the same format the rclone CLI uses, so it
  is portable in and out) and `bin/` for self-updated rclone binaries.
- **Ports:** `:3000` serves UI + API.
- **Deliverables:** published Docker image, a `docker-compose.yml`, a `docker run` snippet, an
  Unraid Community Apps template, and Portainer stack instructions.

Example:

```yaml
services:
  rclone-gui:
    image: <published-image>
    ports: ["3000:3000"]
    volumes: ["./config:/config"]
    environment:
      - GUI_PASSWORD=changeme   # omit to run unprotected (banner shown)
```

## Repository structure

The forked rclone Go source is **removed** from this repository (executed during
implementation, not before). The repo becomes a pure GUI project at the **root**:

```
/                     repo root = rclone-gui
  server/             Fastify backend (TypeScript)
    rclone/           rc client, child-process supervisor, version updater
    api/              REST + WebSocket route handlers
    auth/             optional password/session gate
  web/                React + Vite SPA (TypeScript)
    components/       OptionField, wizard steps, remote cards, app shell
    api/              typed client for /api
  Dockerfile          multi-stage: fetch+verify pinned rclone, build SPA, assemble
  docker-compose.yml
  package.json
  docs/               project docs (incl. this spec under docs/superpowers/specs/)
```

## Testing strategy

- **Backend unit:** the option→field mapping, the rc-client wrapper, the version/update logic
  (mocked GitHub + checksum verification).
- **Backend integration:** run a real `rclone rcd` against the `local`/`memory` backends and
  exercise create/list/update/delete/test — **no cloud credentials required**.
- **Frontend unit:** `<OptionField>` across every type and flag combination.
- **Frontend flow:** wizard end-to-end creating a `local` remote.
- All of Stage 1 is therefore testable in CI with zero secrets.

## Out of scope for Stage 1

File browsing, transfers/sync, mounts, `serve`, scheduling, multi-user auth, bandwidth limits,
notifications — all deferred to later stages.

## Open items deferred to implementation planning

- Exact pinned rclone version and the asset-selection logic for OS/arch.
- Session storage mechanism for the optional auth gate.
- Caching/refresh policy for `config/providers` output.
- Error-surface conventions for failed rc calls (toast vs. inline).
```
