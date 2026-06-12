# rclone GUI — Stage 3 Design (Serve & Mounts)

**Date:** 2026-06-11
**Status:** Approved-by-delegation design (user delegated decisions; adjust on review)
**Scope:** Stage 3 of the roadmap. Builds on Stages 1–2 (complete, merged, pushed).

## Summary

Manage long-running rclone access points from the GUI:
- **Serve** — expose a remote over a network protocol (`rclone serve` — WebDAV/HTTP/SFTP/FTP/DLNA/NFS/S3/restic): start, list, stop.
- **Mounts** — mount a remote as a local filesystem (`rclone mount`): mount, list, unmount.

Both are driven through rclone's rc API (`serve/*`, `mount/*`), so — like every other stage — the backend stays a thin typed proxy. The serve/mount instances run inside the supervised `rcd` process.

## Key decisions (made under delegation)

1. **Use the rc `serve/*` and `mount/*` endpoints** (verified present in rclone v1.74.3) rather than spawning separate child processes. Instances live in the `rcd` process; this is consistent with the rest of the app and needs no extra process supervision.
2. **Serve is the primary, fully-tested feature.** It is container-friendly (just binds a port). `rclone serve` types available: `dlna, ftp, http, nfs, restic, s3, sftp, webdav`.
3. **Mounts are included but require host privileges.** `rclone mount` needs FUSE: in Docker that means `--cap-add SYS_ADMIN --device /dev/fuse` (and `--security-opt apparmor:unconfined` on some hosts), plus a bind-mounted mount target with `rshared` propagation to see mounts on the host. The GUI surfaces mounts and a clear note about these requirements; mount calls that fail (no FUSE) surface rclone's error in the UI. Mount logic is unit-tested with a mocked rc client (FUSE can't run in CI).
4. **Instance lifetime = `rcd` lifetime.** Serves/mounts started via the API live until stopped or until the container restarts (rclone does not persist them). Re-establishing on restart is a later concern (could tie into Stage 4 scheduling).
5. **No auth/option depth for serve in v1.** Start a serve with type + remote + path + optional bind address; advanced serve options (auth user/pass, vfs flags) are deferred. (The backend passes an `opt` map through, so this can grow without API changes.)

## Endpoints relied on (verified, rclone v1.74.3)

- `serve/types` → `{ types: string[] }`
- `serve/start {type, fs, addr, opt?}` → `{ id, addr }` (addr echoes the resolved bind address; `addr:"ip:0"` picks a free port)
- `serve/list` → `{ list: [{ id, addr, params: { type, fs, addr } }] }`
- `serve/stop {id}` · `serve/stopall`
- `mount/types` → `{ mountTypes: string[] }`
- `mount/mount {fs, mountPoint, mountType?, vfsOpt?, mountOpt?}` → `{}`
- `mount/listmounts` → `{ mountPoints: [{ Fs, MountPoint, ... }] }`
- `mount/unmount {mountPoint}` · `mount/unmountall`

fs is `"<remote>:<path>"` (Stage 2 convention).

## Architecture (additions)

### Backend (`server/src`)
- `rclone/serve.ts` — `ServeService`: `types()`, `start(type, remote, path, addr?, opt?)`, `list()`, `stop(id)`.
- `rclone/mounts.ts` — `MountService`: `types()`, `mount(remote, path, mountPoint, mountType?)`, `list()`, `unmount(mountPoint)`.
- `routes/serve.ts` — `GET /api/serve`, `GET /api/serve/types`, `POST /api/serve`, `POST /api/serve/:id/stop`.
- `routes/mounts.ts` — `GET /api/mounts`, `GET /api/mounts/types`, `POST /api/mounts`, `POST /api/mounts/unmount`.
- Wired into `buildApp`/bootstrap sharing the one `RcClient`.

### Frontend (`web/src`)
- `api` — types (`ServeInstance`, `MountInstance`) + methods.
- `pages/ServePage.tsx` — list running serves (type, address, fs) with Stop; a "start serve" form (type dropdown from `serve/types`, remote picker, path, optional address). The address is shown as a clickable link for http/webdav.
- `pages/MountsPage.tsx` — list mounts with Unmount; a "mount" form (remote, path, mount point, type); a prominent note about Docker FUSE privileges.
- Sidebar: enable **Serve** and **Mounts** nav items (Mounts was "soon").

## Plan split
1. **Plan A — Backend:** serve + mount services, endpoints, wiring; serve tested against a real `rcd` (start http serve, list, fetch served content, stop), mount unit-tested with a mocked client + `mount/types` smoke.
2. **Plan B — Frontend:** Serve page, Mounts page, nav enablement, tests (mocked API).

## Testing strategy
- **Serve:** real `rcd` integration — start an `http` serve over a local remote, assert it appears in the list with a resolved address, fetch a file from that address, then stop it and assert it's gone. No cloud creds.
- **Mount:** unit tests with a mocked `RcClient` (assert correct rc paths/params for mount/unmount/list) plus a live `mount/types` call; do NOT attempt a real FUSE mount in tests.
- **Frontend:** component tests with a mocked API client.

## Risks / notes
- **FUSE in Docker:** documented in the Mounts page and README; without the right flags, mount calls fail and the error is shown. Not a code defect.
- **Port conflicts for serve:** using `addr` host with `:0` lets rclone pick a free port; the resolved address is returned and displayed.
- **Security:** served endpoints may be unauthenticated depending on type/options; v1 surfaces the address and a note. Auth options for serve are a later enhancement.

## Out of scope (later stages)
Scheduling/automation (Stage 4); bandwidth limits, notifications, multi-user, re-establishing serves/mounts on restart (Stage 5).
