# rclone GUI — Stage 1 Plan 3: Packaging & Version Updater

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app deployable as a single Docker container — the backend serves the built SPA — and add a runtime rclone-version self-updater (check GitHub for the latest release, download + checksum-verify it onto the `/config` volume, hot-swap the supervised daemon) with a Settings UI.

**Architecture:** A multi-stage Dockerfile downloads + verifies the pinned rclone binary, builds the web SPA and the server, and assembles a small runtime image whose single Node process serves `/api/*` + the static SPA and supervises `rclone rcd`. The updater reuses `scripts/fetch-rclone.sh` (the same verified-download logic) to install a new binary into `<configDir>/bin/rclone` — which `resolveRcloneBinary` already prefers — then restarts the daemon and invalidates the providers cache.

**Tech Stack:** adds `@fastify/static` (already a server dependency from Plan 1). Docker (multi-stage, node:20-slim runtime with `bash`, `curl`, `unzip`, `ca-certificates`). Node global `fetch` for the GitHub releases API.

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-1-design.md`
**Builds on:** Plan 1 (backend) and Plan 2 (frontend), both merged to `master`. Relevant existing hooks:
- `resolveRcloneBinary({override, configDir, cwd})` already prefers `<configDir>/bin/rclone` over the image baseline.
- `getRcloneVersion(binary)` and `parseRcloneVersion(stdout)` exist in `server/src/rclone/resolveBinary.ts`.
- `ProvidersService.invalidate()` exists.
- `scripts/fetch-rclone.sh` already downloads + SHA256-verifies rclone for a given `RCLONE_VERSION` into `DEST_DIR` (both overridable via env).
- `server/src/config.ts` `AppConfig` and `loadConfig()`.
- `buildApp(deps)` in `server/src/app.ts`; bootstrap in `server/src/index.ts`.

**This plan delivers:** `docker build` produces a runnable image; `docker run -p 3000:3000 -v ...:/config` serves the full GUI; Settings shows the installed rclone version, whether an update is available, and an Update button. New backend logic is unit-tested with injected dependencies (no network in tests).

---

## File structure introduced/changed by this plan

```
server/src/
  config.ts                 # + webRoot, fetchScriptPath
  rclone/daemon.ts          # + restart()
  rclone/version.ts         # NEW: VersionService (status/update) + real deps
  routes/static.ts          # NEW: serve SPA + SPA fallback
  routes/version.ts         # NEW: GET /api/version, POST /api/version/update
  app.ts                    # wire static + version routes
  index.ts                  # construct VersionService with real deps
web/src/pages/SettingsPage.tsx   # version UI (replaces stub)
Dockerfile                  # NEW: multi-stage build
.dockerignore               # NEW
docker-compose.yml          # NEW
README.md                   # NEW: run/deploy instructions
```

---

## Task 1: Serve the built SPA from the backend

**Files:**
- Modify: `server/src/config.ts`, `server/src/app.ts`, `server/src/index.ts`
- Create: `server/src/routes/static.ts`
- Test: `server/test/static.test.ts`

- [ ] **Step 1: Add `webRoot` to config**

In `server/src/config.ts`, add to the `AppConfig` interface:
```ts
  webRoot: string | null; // directory of built SPA assets; null disables static serving
```
and in `loadConfig`'s returned object add:
```ts
    webRoot: env.WEB_ROOT ?? null,
```

- [ ] **Step 2: Create `server/src/routes/static.ts`**

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Serve the built SPA from `webRoot`, with a history-API fallback: any GET that
 * isn't an /api route and didn't match a static file returns index.html so
 * client-side routes work on reload.
 */
export function staticRoutes(webRoot: string) {
  return async function (app: FastifyInstance): Promise<void> {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });

    const indexPath = path.join(webRoot, "index.html");
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && existsSync(indexPath)) {
        const html = await readFile(indexPath, "utf8");
        return reply.type("text/html").send(html);
      }
      return reply.code(404).send({ error: "not found", status: 404 });
    });
  };
}
```

- [ ] **Step 3: Wire into `server/src/app.ts`**

Add to `BuildAppDeps`:
```ts
  webRoot?: string | null;
```
Add the import at the top:
```ts
import { staticRoutes } from "./routes/static.js";
```
And register it LAST in `buildApp` (after the api routes, before `return app`):
```ts
  if (deps.webRoot) await app.register(staticRoutes(deps.webRoot));
```

- [ ] **Step 4: Pass it through in `server/src/index.ts`**

In the `buildApp({...})` call, add:
```ts
    webRoot: cfg.webRoot,
```

- [ ] **Step 5: Write the failing test `server/test/static.test.ts`**

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "rg-web-"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>rclone GUI</title>", "utf8");
  await writeFile(path.join(dir, "app.js"), "console.log('hi')", "utf8");
  app = await buildApp({ webRoot: dir });
});
afterAll(async () => { await app.close(); });

test("serves index.html at root", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("rclone GUI");
});

test("serves static asset files", async () => {
  const res = await app.inject({ method: "GET", url: "/app.js" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("console.log");
});

test("unknown non-api GET falls back to index.html (SPA routing)", async () => {
  const res = await app.inject({ method: "GET", url: "/settings" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("rclone GUI");
});

test("unknown /api route returns JSON 404, not html", async () => {
  const res = await app.inject({ method: "GET", url: "/api/nope" });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ status: 404 });
});

test("health still works alongside static", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 6: Run the test**

Run: `npm --workspace server run test static`
Expected: 5 passing tests.

- [ ] **Step 7: Run the full server suite** to confirm no regression (`npm --workspace server run test`).

- [ ] **Step 8: Commit**

```bash
git add server/src/config.ts server/src/routes/static.ts server/src/app.ts server/src/index.ts server/test/static.test.ts
git commit -m "feat(server): serve built SPA with history-API fallback"
```

---

## Task 2: Daemon restart + VersionService

**Files:**
- Modify: `server/src/rclone/daemon.ts`
- Create: `server/src/rclone/version.ts`
- Test: `server/test/version.test.ts`

- [ ] **Step 1: Add `restart()` to `RcloneDaemon`**

In `server/src/rclone/daemon.ts`, add this public method to the `RcloneDaemon` class (after `stop()`):
```ts
  /** Stop and start the daemon (used after the binary is updated). */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
```
(Note: `start()` already resets the `stopping` flag, so restart works.)

- [ ] **Step 2: Create `server/src/rclone/version.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VersionStatus {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

/** Dependencies injected so the service is unit-testable without network/disk. */
export interface VersionDeps {
  /** Read the currently-installed rclone version (e.g. "v1.74.3"). */
  getInstalled: () => Promise<string | null>;
  /** Fetch the latest released rclone version tag from GitHub. */
  fetchLatest: () => Promise<string | null>;
  /** Download + verify + install the given version onto the config volume. */
  install: (version: string) => Promise<void>;
  /** Called after a successful install (restart daemon, invalidate caches). */
  afterInstall: () => Promise<void>;
}

export class VersionService {
  constructor(private readonly deps: VersionDeps) {}

  async status(): Promise<VersionStatus> {
    const [installed, latest] = await Promise.all([
      this.deps.getInstalled(),
      this.deps.fetchLatest().catch(() => null), // offline => latest unknown, not an error
    ]);
    return {
      installed,
      latest,
      updateAvailable: Boolean(installed && latest && installed !== latest),
    };
  }

  /** Update to the latest version (or a specific one). Returns the new status. */
  async update(version?: string): Promise<VersionStatus> {
    const target = version ?? (await this.deps.fetchLatest());
    if (!target) throw new Error("could not determine latest rclone version");
    await this.deps.install(target);
    await this.deps.afterInstall();
    return this.status();
  }
}

/** Parse the tag_name from the GitHub "latest release" API payload. */
export function parseLatestTag(json: unknown): string | null {
  if (json && typeof json === "object" && "tag_name" in json) {
    const tag = (json as { tag_name: unknown }).tag_name;
    return typeof tag === "string" ? tag : null;
  }
  return null;
}

/** Real GitHub fetch implementation. */
export async function fetchLatestFromGitHub(): Promise<string | null> {
  const res = await fetch("https://api.github.com/repos/rclone/rclone/releases/latest", {
    headers: { accept: "application/vnd.github+json", "user-agent": "rclone-gui" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return parseLatestTag(await res.json());
}

/**
 * Real installer: runs scripts/fetch-rclone.sh (download + SHA256 verify + unzip)
 * with RCLONE_VERSION and DEST_DIR pointed at <configDir>/bin.
 */
export function makeScriptInstaller(scriptPath: string, configDir: string) {
  return async function install(version: string): Promise<void> {
    await execFileAsync("bash", [scriptPath], {
      env: { ...process.env, RCLONE_VERSION: version, DEST_DIR: `${configDir}/bin` },
    });
  };
}
```

- [ ] **Step 3: Write the failing test `server/test/version.test.ts`**

```ts
import { expect, test, vi } from "vitest";
import { VersionService, parseLatestTag } from "../src/rclone/version.js";

test("parseLatestTag extracts tag_name", () => {
  expect(parseLatestTag({ tag_name: "v1.74.3" })).toBe("v1.74.3");
  expect(parseLatestTag({})).toBeNull();
  expect(parseLatestTag(null)).toBeNull();
});

test("status reports updateAvailable when installed != latest", async () => {
  const svc = new VersionService({
    getInstalled: async () => "v1.74.3",
    fetchLatest: async () => "v1.75.0",
    install: async () => {},
    afterInstall: async () => {},
  });
  expect(await svc.status()).toEqual({ installed: "v1.74.3", latest: "v1.75.0", updateAvailable: true });
});

test("status: offline latest is null, not an error, and not an update", async () => {
  const svc = new VersionService({
    getInstalled: async () => "v1.74.3",
    fetchLatest: async () => { throw new Error("offline"); },
    install: async () => {},
    afterInstall: async () => {},
  });
  expect(await svc.status()).toEqual({ installed: "v1.74.3", latest: null, updateAvailable: false });
});

test("update installs the latest version then runs afterInstall", async () => {
  const order: string[] = [];
  const install = vi.fn(async (v: string) => { order.push(`install:${v}`); });
  const afterInstall = vi.fn(async () => { order.push("after"); });
  const svc = new VersionService({
    getInstalled: async () => "v1.75.0", // after install
    fetchLatest: async () => "v1.75.0",
    install,
    afterInstall,
  });
  const status = await svc.update();
  expect(install).toHaveBeenCalledWith("v1.75.0");
  expect(order).toEqual(["install:v1.75.0", "after"]); // install BEFORE afterInstall
  expect(status.installed).toBe("v1.75.0");
});

test("update throws if no version can be determined", async () => {
  const svc = new VersionService({
    getInstalled: async () => null,
    fetchLatest: async () => null,
    install: async () => {},
    afterInstall: async () => {},
  });
  await expect(svc.update()).rejects.toThrow(/could not determine/);
});
```

- [ ] **Step 4: Run the test**

Run: `npm --workspace server run test version`
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/rclone/daemon.ts server/src/rclone/version.ts server/test/version.test.ts
git commit -m "feat(server): rclone version service (status/update) + daemon restart"
```

---

## Task 3: Version routes + bootstrap wiring

**Files:**
- Modify: `server/src/config.ts`, `server/src/app.ts`, `server/src/index.ts`
- Create: `server/src/routes/version.ts`
- Test: `server/test/version-routes.test.ts`

- [ ] **Step 1: Add `fetchScriptPath` to config**

In `server/src/config.ts`, add to `AppConfig`:
```ts
  fetchScriptPath: string; // path to scripts/fetch-rclone.sh used by the updater
```
and to `loadConfig`'s return:
```ts
    fetchScriptPath: env.RCLONE_FETCH_SCRIPT ?? "scripts/fetch-rclone.sh",
```

- [ ] **Step 2: Create `server/src/routes/version.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { VersionService } from "../rclone/version.js";

export function versionRoutes(version: VersionService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/version", async () => version.status());
    app.post<{ Body: { version?: string } }>("/api/version/update", async (req) => {
      return version.update(req.body?.version);
    });
  };
}
```

- [ ] **Step 3: Wire into `server/src/app.ts`**

Add to `BuildAppDeps`:
```ts
  version?: VersionService;
```
Import at top:
```ts
import { versionRoutes } from "./routes/version.js";
import type { VersionService } from "./rclone/version.js";
```
Register with the other api routes (before static):
```ts
  if (deps.version) await app.register(versionRoutes(deps.version));
```

- [ ] **Step 4: Construct the real `VersionService` in `server/src/index.ts`**

Add imports:
```ts
import { VersionService, fetchLatestFromGitHub, makeScriptInstaller } from "./rclone/version.js";
import { getRcloneVersion } from "./rclone/resolveBinary.js";
```
After the daemon is started and `client`/services are created, build the version service. The `install` writes to `<configDir>/bin`; `afterInstall` restarts the daemon and invalidates the providers cache:
```ts
  const providers = new ProvidersService(client);
  const version = new VersionService({
    getInstalled: () => getRcloneVersion(binary),
    fetchLatest: fetchLatestFromGitHub,
    install: makeScriptInstaller(cfg.fetchScriptPath, cfg.configDir),
    afterInstall: async () => {
      await daemon.restart();
      providers.invalidate();
    },
  });
  const app = await buildApp({
    providers,
    remotes: new RemoteService(client),
    version,
    guiPassword: cfg.guiPassword,
    webRoot: cfg.webRoot,
  });
```
(Replace the existing `buildApp({...})` block accordingly; ensure `providers` is created as a named const so both the service and the updater share the same instance — invalidating the cache the app actually uses.)

- [ ] **Step 5: Write the failing test `server/test/version-routes.test.ts`**

```ts
import { afterEach, expect, test, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { VersionService } from "../src/rclone/version.js";

let app: FastifyInstance;
afterEach(async () => { if (app) await app.close(); });

test("GET /api/version returns the status", async () => {
  const version = new VersionService({
    getInstalled: async () => "v1.74.3",
    fetchLatest: async () => "v1.75.0",
    install: async () => {},
    afterInstall: async () => {},
  });
  app = await buildApp({ version });
  const res = await app.inject({ method: "GET", url: "/api/version" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ installed: "v1.74.3", latest: "v1.75.0", updateAvailable: true });
});

test("POST /api/version/update triggers install + afterInstall", async () => {
  const install = vi.fn(async () => {});
  const afterInstall = vi.fn(async () => {});
  const version = new VersionService({
    getInstalled: async () => "v1.75.0",
    fetchLatest: async () => "v1.75.0",
    install,
    afterInstall,
  });
  app = await buildApp({ version });
  const res = await app.inject({ method: "POST", url: "/api/version/update", payload: {} });
  expect(res.statusCode).toBe(200);
  expect(install).toHaveBeenCalledWith("v1.75.0");
  expect(afterInstall).toHaveBeenCalled();
});
```

- [ ] **Step 6: Run the test**

Run: `npm --workspace server run test version-routes`
Expected: 2 passing tests.

- [ ] **Step 7: Full server suite** green (`npm --workspace server run test`).

- [ ] **Step 8: Commit**

```bash
git add server/src/config.ts server/src/routes/version.ts server/src/app.ts server/src/index.ts server/test/version-routes.test.ts
git commit -m "feat(server): version status/update endpoints + bootstrap wiring"
```

---

## Task 4: Settings page version UI

**Files:**
- Modify: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/pages/SettingsPage.tsx`
- Test: `web/src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Add the version type and client methods**

In `web/src/api/types.ts` add:
```ts
export interface VersionStatus {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}
```
In `web/src/api/client.ts`, import `VersionStatus` in the type import list, and add to the `api` object:
```ts
  version: () => request<VersionStatus>("/api/version"),
  updateRclone: () =>
    request<VersionStatus>("/api/version/update", { method: "POST", body: JSON.stringify({}) }),
```

- [ ] **Step 2: REPLACE `web/src/pages/SettingsPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { VersionStatus } from "../api/types.js";

export function SettingsPage() {
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.version().then(setStatus).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function update() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.updateRclone());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Settings</h2>
      <h3>rclone version</h3>
      {error ? <p className="error-text">{error}</p> : null}
      {!status ? (
        <p>Loading…</p>
      ) : (
        <div>
          <p>
            Installed: <b>{status.installed ?? "unknown"}</b>
            {status.latest ? <> · Latest: <b>{status.latest}</b></> : <> · Latest: <span className="hint">unknown (offline?)</span></>}
          </p>
          {status.updateAvailable ? (
            <button className="btn" disabled={busy} onClick={update}>
              {busy ? "Updating…" : `Update to ${status.latest}`}
            </button>
          ) : (
            <p className="hint">{status.installed ? "Up to date." : "No version detected."}</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the failing test `web/src/pages/SettingsPage.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

test("shows installed + latest and offers update when available", async () => {
  vi.spyOn(api, "version").mockResolvedValue({ installed: "v1.74.3", latest: "v1.75.0", updateAvailable: true });
  const upd = vi.spyOn(api, "updateRclone").mockResolvedValue({ installed: "v1.75.0", latest: "v1.75.0", updateAvailable: false });

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText("v1.74.3")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: /Update to v1.75.0/ }));
  await waitFor(() => expect(upd).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText("Up to date.")).toBeInTheDocument());
});

test("shows up-to-date when no update available", async () => {
  vi.spyOn(api, "version").mockResolvedValue({ installed: "v1.75.0", latest: "v1.75.0", updateAvailable: false });
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText("Up to date.")).toBeInTheDocument());
});
```

- [ ] **Step 4: Run the test**

Run: `npm --workspace web run test SettingsPage`
Expected: 2 passing tests.

- [ ] **Step 5: Full web suite + build** green (`npm --workspace web run test` and `npm --workspace web run build`).

- [ ] **Step 6: Commit**

```bash
git add web/src/api/types.ts web/src/api/client.ts web/src/pages/SettingsPage.tsx web/src/pages/SettingsPage.test.tsx
git commit -m "feat(web): Settings page with rclone version status + update"
```

---

## Task 5: Dockerfile, compose, and README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `README.md`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
**/node_modules
**/dist
.rclone
.git
.superpowers
*.log
```

- [ ] **Step 2: Create `Dockerfile`** (multi-stage; pins rclone v1.74.3, matching `scripts/fetch-rclone.sh`)

```dockerfile
# syntax=docker/dockerfile:1

# ---- Stage 1: fetch + verify the pinned rclone binary ----
FROM alpine:3.20 AS rclone
ARG RCLONE_VERSION=v1.74.3
ARG TARGETARCH=amd64
RUN apk add --no-cache curl unzip
WORKDIR /tmp
RUN set -eux; \
    ZIP="rclone-${RCLONE_VERSION}-linux-${TARGETARCH}.zip"; \
    BASE="https://downloads.rclone.org/${RCLONE_VERSION}"; \
    curl -fsSL "${BASE}/${ZIP}" -o rclone.zip; \
    curl -fsSL "${BASE}/SHA256SUMS" -o SHA256SUMS; \
    expected="$(grep "  ${ZIP}\$" SHA256SUMS | awk '{print $1}')"; \
    echo "${expected}  rclone.zip" | sha256sum -c -; \
    unzip -q rclone.zip; \
    mv "rclone-${RCLONE_VERSION}-linux-${TARGETARCH}/rclone" /usr/local/bin/rclone; \
    chmod +x /usr/local/bin/rclone

# ---- Stage 2: build the web SPA and the server ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
RUN npm --workspace web run build
RUN npm --workspace server run build

# ---- Stage 3: runtime ----
FROM node:20-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash curl unzip ca-certificates fuse3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Production server deps only
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server

# Built artifacts
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
# Updater script + pinned baseline binary
COPY scripts/fetch-rclone.sh scripts/fetch-rclone.sh
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    RCLONE_GUI_CONFIG_DIR=/config \
    WEB_ROOT=/app/web/dist \
    RCLONE_FETCH_SCRIPT=/app/scripts/fetch-rclone.sh

VOLUME ["/config"]
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
```

NOTE on binary resolution (do NOT set `RCLONE_BINARY` in the image): the baseline binary lives at `/usr/local/bin/rclone`, which is on `PATH`. We intentionally leave `RCLONE_BINARY` unset so `resolveRcloneBinary` follows its priority order — `<configDir>/bin/rclone` (i.e. `/config/bin/rclone`, where the self-updater installs) first, then the `rclone` baseline on `PATH`. This way a self-updated binary takes effect after restart while a fresh container still finds the baked-in baseline. The ENV block above is already correct (no `RCLONE_BINARY`).

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  rclone-gui:
    build: .
    image: rclone-gui:latest
    ports:
      - "3000:3000"
    volumes:
      - ./config:/config
    environment:
      # Set a password to require login; omit to run unprotected (a banner is shown).
      - GUI_PASSWORD=${GUI_PASSWORD:-}
    restart: unless-stopped
```

- [ ] **Step 4: Create `README.md`**

```markdown
# rclone GUI

A self-hostable web GUI for [rclone](https://rclone.org). Configure every rclone
remote through auto-generated forms (each field carries rclone's own help text as a
tooltip and its default value), test connections, and manage the bundled rclone
binary — all from one Docker container.

> Stage 1 (Remotes & Configuration). Browsing, transfers, mounts, and scheduling
> are planned for later stages.

## Run with Docker

```bash
docker compose up -d --build
# or:
docker build -t rclone-gui .
docker run -d -p 3000:3000 -v "$PWD/config:/config" -e GUI_PASSWORD=changeme rclone-gui
```

Open <http://localhost:3000>. rclone's config is persisted at `/config/rclone.conf`.

- Set `GUI_PASSWORD` to require login. Omit it to run unprotected (a warning banner is shown).
- The container bundles a pinned rclone; **Settings** shows the installed version and
  can update it (downloaded + checksum-verified to `/config/bin/rclone`, which persists).

### Unraid / Portainer
Use the image with a single volume mapped to `/config` and port `3000` published; set
`GUI_PASSWORD` as an environment variable.

## Develop

```bash
npm install
npm run fetch-rclone                 # download pinned rclone into ./.rclone (for the backend)
RCLONE_BINARY="$PWD/.rclone/rclone" RCLONE_GUI_CONFIG_DIR="$PWD/.devconfig" \
  npm --workspace server run dev     # backend on :3000
npm --workspace web run dev          # SPA on Vite's port, proxying /api -> :3000
npm --workspace server run test      # backend tests (real rclone rcd, local backend)
npm --workspace web run test         # frontend tests (mocked API)
```
```

- [ ] **Step 5: Build the image (verification)**

Run: `docker build -t rclone-gui:test .`
Expected: build succeeds through all stages. (If Docker is unavailable in this environment, report that and proceed — the Dockerfile is then verified by careful review only; note it explicitly.)

If the build succeeds, smoke test:
```bash
docker run -d --name rg-smoke -p 3001:3000 -v "$(mktemp -d):/config" rclone-gui:test
sleep 4
curl -s localhost:3001/api/health
curl -s localhost:3001/api/version
curl -s localhost:3001/ | head -c 80
docker rm -f rg-smoke
```
Expected: `{"status":"ok"}`, a version JSON, and HTML.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml README.md
git commit -m "feat: Dockerfile (pinned rclone), compose, and README"
```

---

## Self-review notes (author check against the spec)

- **Single container, backend serves SPA** → Task 1 (`@fastify/static` + SPA fallback) + Task 5 (runtime stage runs the server with `WEB_ROOT`).
- **Pinned rclone baked in, checksum-verified** → Dockerfile stage 1 (Task 5), matching `scripts/fetch-rclone.sh` pin.
- **Runtime self-updater: check GitHub, verify, install to `/config/bin`, hot-swap, invalidate cache** → Tasks 2–3 (`VersionService`, `daemon.restart()`, `makeScriptInstaller`, `afterInstall` invalidates providers). Resolver already prefers `/config/bin/rclone`.
- **Settings UI for version** → Task 4.
- **Unraid/Portainer-friendly deploy** → compose + README (Task 5), single `/config` volume + `:3000`.

Deliberate limitations (documented): the real network paths (`fetchLatestFromGitHub`, the script-based install) are exercised via injected-dependency unit tests rather than live network/Docker in CI; they reuse the already-working `scripts/fetch-rclone.sh` verification logic. The Docker build/smoke step is best-effort if Docker isn't available in the execution environment.

## Execution handoff

After this plan, Stage 1 is complete and deployable. Stage 2 (browse + transfers) would be the next spec → plan → implement cycle.
