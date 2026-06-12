# rclone GUI — Stage 1 Plan 1: Backend & rclone Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Fastify (TypeScript) backend that supervises a child `rclone rcd` process and exposes a REST API to list/create/update/delete/test rclone remotes, with auto-discovered provider/option metadata and optional password auth.

**Architecture:** A single Node process spawns `rclone rcd` bound to `127.0.0.1` on a random port with random Basic-Auth credentials, then proxies typed REST endpoints to rclone's rc HTTP API. The rc daemon is never exposed outside the process; only Fastify holds its credentials. The interactive `config/create` state-machine is exposed generically so OAuth backends work through the same path as simple ones.

**Tech Stack:** Node 20+, TypeScript (ESM), Fastify 4, Vitest, `tsx` for dev. Node's global `fetch` for rc calls. rclone pinned to **v1.74.3** (latest published release as of 2026-06-11; the working tree's old `VERSION` file said v1.75.0, but that is the unreleased dev version and has no downloadable artifact).

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-1-design.md`

**This plan delivers:** a runnable backend (`npm run dev` in `server/`) whose API is fully exercised by integration tests against a real `rcd` using rclone's `local`/`memory` backends — no cloud credentials required. Frontend and Docker packaging are Plans 2 and 3.

---

## File structure introduced by this plan

```
/                          repo root (rclone Go source removed in Task 1)
  package.json             npm workspaces root: ["server", "web"]
  tsconfig.base.json       shared TS compiler options
  .gitignore               add node_modules, dist, .rclone/
  scripts/
    fetch-rclone.sh        download + SHA256-verify pinned rclone into ./.rclone/
  server/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      config.ts            env/config (port, GUI_PASSWORD, config path, rclone bin)
      app.ts               buildApp(): Fastify instance + routes (no listen)
      index.ts             bootstrap: start daemon, build app, listen
      rclone/
        types.ts           RcOption, RcProvider, RemoteSummary, ConfigOut types
        resolveBinary.ts   locate the rclone binary + read its version
        daemon.ts          RcloneDaemon: spawn/supervise/stop the rcd child
        client.ts          RcClient: authenticated POST to rcd, error mapping
        remotes.ts         high-level remote operations built on RcClient
        providers.ts       providers fetch + in-memory cache
      routes/
        health.ts          GET /api/health
        providers.ts       GET /api/providers
        remotes.ts         GET/POST/PUT/DELETE /api/remotes (+ /continue, /test)
      auth/
        gate.ts            optional GUI_PASSWORD login + preHandler
    test/
      helpers/rcd.ts       spin up a real RcloneDaemon for integration tests
      *.test.ts            colocated or under test/
```

---

## Task 1: Repo restructure and root tooling

Remove the forked rclone Go source (the GUI consumes rclone as a binary; see spec) and establish the npm-workspaces root. The design spec and plans under `docs/superpowers/` are preserved.

**Files:**
- Delete: all rclone Go source (everything except `.git`, `docs/superpowers/`, and `.gitignore`)
- Create: `package.json`, `tsconfig.base.json`
- Modify: `.gitignore`

- [ ] **Step 1: Preserve the specs/plans, then remove rclone source**

```bash
# Move the brainstorming/plan docs out of the way, wipe the tree, restore them.
mkdir -p /tmp/rclone-gui-keep
cp -a docs/superpowers /tmp/rclone-gui-keep/
git rm -rq --ignore-unmatch -- ':!.gitignore'
# Restore the docs we want to keep
mkdir -p docs
cp -a /tmp/rclone-gui-keep/superpowers docs/
git add docs/superpowers
```

Expected: `git status` shows the rclone Go source staged for deletion and `docs/superpowers/**` retained.

- [ ] **Step 2: Create the workspaces root `package.json`**

Create `package.json`:

```json
{
  "name": "rclone-gui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["server", "web"],
  "engines": { "node": ">=20" },
  "scripts": {
    "fetch-rclone": "bash scripts/fetch-rclone.sh",
    "dev": "npm --workspace server run dev",
    "test": "npm --workspace server run test"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Update `.gitignore`**

Replace the file contents with:

```gitignore
node_modules/
dist/
.rclone/
*.log
.DS_Store
.superpowers/
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove forked rclone source, scaffold GUI workspaces root"
```

---

## Task 2: Pinned rclone fetch script (for local dev and tests)

A shell script that downloads the pinned rclone release and verifies its SHA256, used by developers and CI so integration tests have a real binary. The Docker build (Plan 3) reuses the same pin.

**Files:**
- Create: `scripts/fetch-rclone.sh`

- [ ] **Step 1: Write the script**

Create `scripts/fetch-rclone.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Pinned rclone version for reproducible local/CI installs.
RCLONE_VERSION="${RCLONE_VERSION:-v1.75.0}"
DEST_DIR="${DEST_DIR:-.rclone}"

case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=osx ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

VER_NO_V="${RCLONE_VERSION#v}"
ZIP="rclone-${RCLONE_VERSION}-${OS}-${ARCH}.zip"
BASE="https://downloads.rclone.org/${RCLONE_VERSION}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${ZIP}..."
curl -fsSL "${BASE}/${ZIP}" -o "${tmp}/${ZIP}"
curl -fsSL "${BASE}/SHA256SUMS" -o "${tmp}/SHA256SUMS"

echo "Verifying SHA256..."
expected="$(grep "  ${ZIP}\$" "${tmp}/SHA256SUMS" | awk '{print $1}')"
if [ -z "${expected}" ]; then echo "no checksum for ${ZIP}" >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${tmp}/${ZIP}" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "${tmp}/${ZIP}" | awk '{print $1}')"
fi
if [ "${expected}" != "${actual}" ]; then
  echo "checksum mismatch: expected ${expected} got ${actual}" >&2; exit 1
fi

mkdir -p "${DEST_DIR}"
( cd "${tmp}" && unzip -q "${ZIP}" )
cp "${tmp}/rclone-${RCLONE_VERSION}-${OS}-${ARCH}/rclone" "${DEST_DIR}/rclone"
chmod +x "${DEST_DIR}/rclone"
echo "rclone ${RCLONE_VERSION} installed at ${DEST_DIR}/rclone"
```

- [ ] **Step 2: Make it executable and run it**

Run:
```bash
chmod +x scripts/fetch-rclone.sh
npm run fetch-rclone
```
Expected: prints `rclone v1.75.0 installed at .rclone/rclone`.

- [ ] **Step 3: Verify the binary works**

Run: `./.rclone/rclone version`
Expected: output begins with `rclone v1.75.0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-rclone.sh
git commit -m "build: add pinned rclone fetch+verify script"
```

---

## Task 3: Server scaffold with Fastify health route

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `server/src/config.ts`, `server/src/app.ts`, `server/src/routes/health.ts`
- Test: `server/test/health.test.ts`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@rclone-gui/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fastify/cookie": "^9.3.1",
    "@fastify/static": "^7.0.4",
    "fastify": "^4.28.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 4: Create `server/src/config.ts`**

```ts
import path from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  guiPassword: string | null;
  rcloneConfigPath: string;
  rcloneBinary: string | null; // explicit override; null => auto-resolve
  configDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configDir = env.RCLONE_GUI_CONFIG_DIR ?? "/config";
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    guiPassword: env.GUI_PASSWORD && env.GUI_PASSWORD.length > 0 ? env.GUI_PASSWORD : null,
    rcloneConfigPath: env.RCLONE_CONFIG ?? path.join(configDir, "rclone.conf"),
    rcloneBinary: env.RCLONE_BINARY ?? null,
    configDir,
  };
}
```

- [ ] **Step 5: Create `server/src/routes/health.ts`**

```ts
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({ status: "ok" }));
}
```

- [ ] **Step 6: Create `server/src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";

export interface BuildAppDeps {
  // later tasks inject RcClient/RemoteService here
}

export async function buildApp(_deps: BuildAppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(healthRoutes);
  return app;
}
```

- [ ] **Step 7: Write the failing test**

Create `server/test/health.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

test("GET /api/health returns ok", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok" });
});
```

- [ ] **Step 8: Install deps and run the test to verify it passes**

Run:
```bash
npm install
npm --workspace server run test
```
Expected: 1 passing test (`GET /api/health returns ok`).

- [ ] **Step 9: Commit**

```bash
git add package-lock.json server/
git commit -m "feat(server): scaffold Fastify app with health route"
```

---

## Task 4: Locate the rclone binary and read its version

**Files:**
- Create: `server/src/rclone/resolveBinary.ts`
- Test: `server/test/resolveBinary.test.ts`

- [ ] **Step 1: Write the implementation**

Create `server/src/rclone/resolveBinary.ts`:

```ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve which rclone binary to run, in priority order:
 *  1. explicit override (config.rcloneBinary)
 *  2. self-updated binary on the config volume (configDir/bin/rclone)
 *  3. local dev binary (./.rclone/rclone)
 *  4. "rclone" on PATH
 */
export function resolveRcloneBinary(opts: {
  override?: string | null;
  configDir?: string;
  cwd?: string;
}): string {
  if (opts.override) return opts.override;
  const candidates: string[] = [];
  if (opts.configDir) candidates.push(path.join(opts.configDir, "bin", "rclone"));
  candidates.push(path.join(opts.cwd ?? process.cwd(), ".rclone", "rclone"));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "rclone";
}

/** Parse the semantic version (e.g. "v1.75.0") from `rclone version` output. */
export function parseRcloneVersion(stdout: string): string | null {
  const m = stdout.match(/rclone\s+(v\d+\.\d+\.\d+\S*)/);
  return m ? m[1] : null;
}

export async function getRcloneVersion(binary: string): Promise<string | null> {
  const { stdout } = await execFileAsync(binary, ["version"]);
  return parseRcloneVersion(stdout);
}
```

- [ ] **Step 2: Write the failing test**

Create `server/test/resolveBinary.test.ts`:

```ts
import { expect, test } from "vitest";
import { parseRcloneVersion, resolveRcloneBinary } from "../src/rclone/resolveBinary.js";

test("parseRcloneVersion extracts the version", () => {
  expect(parseRcloneVersion("rclone v1.75.0\n- os/version: ...")).toBe("v1.75.0");
  expect(parseRcloneVersion("rclone v1.75.0-beta.123")).toBe("v1.75.0-beta.123");
  expect(parseRcloneVersion("garbage")).toBeNull();
});

test("resolveRcloneBinary honors the explicit override", () => {
  expect(resolveRcloneBinary({ override: "/custom/rclone" })).toBe("/custom/rclone");
});

test("resolveRcloneBinary falls back to PATH when nothing exists", () => {
  expect(resolveRcloneBinary({ configDir: "/nonexistent", cwd: "/nonexistent" })).toBe("rclone");
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm --workspace server run test resolveBinary`
Expected: 3 passing tests.

- [ ] **Step 4: Commit**

```bash
git add server/src/rclone/resolveBinary.ts server/test/resolveBinary.test.ts
git commit -m "feat(server): resolve rclone binary path and version"
```

---

## Task 5: Supervised `rclone rcd` daemon

**Files:**
- Create: `server/src/rclone/daemon.ts`
- Create: `server/test/helpers/rcd.ts`
- Test: `server/test/daemon.test.ts`

- [ ] **Step 1: Write the daemon implementation**

Create `server/src/rclone/daemon.ts`:

```ts
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

export interface DaemonEndpoint {
  url: string; // e.g. http://127.0.0.1:5572
  user: string;
  pass: string;
}

export interface RcloneDaemonOptions {
  binary: string;
  configPath: string;
  extraArgs?: string[];
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not get port")));
      }
    });
  });
}

export class RcloneDaemon {
  private child: ChildProcess | null = null;
  private endpoint: DaemonEndpoint | null = null;
  private stopping = false;

  constructor(private readonly opts: RcloneDaemonOptions) {}

  getEndpoint(): DaemonEndpoint {
    if (!this.endpoint) throw new Error("daemon not started");
    return this.endpoint;
  }

  async start(): Promise<DaemonEndpoint> {
    const port = await getFreePort();
    const user = "gui";
    const pass = randomBytes(24).toString("hex");
    const url = `http://127.0.0.1:${port}`;

    const args = [
      "rcd",
      "--rc-addr", `127.0.0.1:${port}`,
      "--rc-user", user,
      "--rc-pass", pass,
      "--config", this.opts.configPath,
      ...(this.opts.extraArgs ?? []),
    ];

    this.child = spawn(this.opts.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.child.on("exit", (code) => {
      this.child = null;
      if (!this.stopping) {
        // Auto-restart on unexpected exit.
        this.start().catch(() => undefined);
      } else {
        void code;
      }
    });

    this.endpoint = { url, user, pass };
    await this.waitReady(url, user, pass);
    return this.endpoint;
  }

  private authHeader(user: string, pass: string): string {
    return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }

  private async waitReady(url: string, user: string, pass: string): Promise<void> {
    const deadline = Date.now() + 15_000;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${url}/rc/noop`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: this.authHeader(user, pass) },
          body: "{}",
        });
        if (res.ok) return;
        lastErr = new Error(`rcd not ready: HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`rcd failed to become ready: ${String(lastErr)}`);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
    });
    this.child = null;
    this.endpoint = null;
  }
}
```

- [ ] **Step 2: Write the integration test helper**

Create `server/test/helpers/rcd.ts`:

```ts
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import { RcloneDaemon } from "../../src/rclone/daemon.js";
import { resolveRcloneBinary } from "../../src/rclone/resolveBinary.js";

export async function startTestDaemon(): Promise<{ daemon: RcloneDaemon; configPath: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rclone-gui-test-"));
  const configPath = path.join(dir, "rclone.conf");
  await writeFile(configPath, "", "utf8");
  const binary = resolveRcloneBinary({ cwd: path.resolve(__dirname, "../../..") });
  const daemon = new RcloneDaemon({ binary, configPath });
  await daemon.start();
  return { daemon, configPath };
}
```

Note: this helper resolves the binary from the repo root's `.rclone/rclone` (run `npm run fetch-rclone` once before testing).

- [ ] **Step 3: Write the failing test**

Create `server/test/daemon.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
beforeAll(async () => { ({ daemon } = await startTestDaemon()); });
afterAll(async () => { await daemon.stop(); });

test("daemon exposes an authenticated endpoint that answers rc/noop", async () => {
  const ep = daemon.getEndpoint();
  expect(ep.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const res = await fetch(`${ep.url}/rc/noop`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Basic " + Buffer.from(`${ep.user}:${ep.pass}`).toString("base64"),
    },
    body: "{}",
  });
  expect(res.ok).toBe(true);
});

test("requests without auth are rejected", async () => {
  const ep = daemon.getEndpoint();
  const res = await fetch(`${ep.url}/rc/noop`, { method: "POST", body: "{}" });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npm run fetch-rclone   # if not already done
npm --workspace server run test daemon
```
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/rclone/daemon.ts server/test/helpers/rcd.ts server/test/daemon.test.ts
git commit -m "feat(server): supervise child rclone rcd with random localhost auth"
```

---

## Task 6: Typed rc client

**Files:**
- Create: `server/src/rclone/client.ts`
- Test: `server/test/client.test.ts`

- [ ] **Step 1: Write the client**

Create `server/src/rclone/client.ts`:

```ts
import type { DaemonEndpoint } from "./daemon.js";

export class RcError extends Error {
  constructor(message: string, readonly status: number, readonly path: string) {
    super(message);
    this.name = "RcError";
  }
}

export interface EndpointProvider {
  getEndpoint(): DaemonEndpoint;
}

export class RcClient {
  constructor(private readonly endpoints: EndpointProvider) {}

  async call<T = Record<string, unknown>>(rcPath: string, params: Record<string, unknown> = {}): Promise<T> {
    const ep = this.endpoints.getEndpoint();
    const res = await fetch(`${ep.url}/${rcPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Basic " + Buffer.from(`${ep.user}:${ep.pass}`).toString("base64"),
      },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text.length ? JSON.parse(text) : {};
    } catch {
      throw new RcError(`invalid JSON from rclone: ${text.slice(0, 200)}`, res.status, rcPath);
    }
    if (!res.ok) {
      const errMsg =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `rc call failed: HTTP ${res.status}`;
      throw new RcError(errMsg, res.status, rcPath);
    }
    return body as T;
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `server/test/client.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { RcClient, RcError } from "../src/rclone/client.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let client: RcClient;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  client = new RcClient(daemon);
});
afterAll(async () => { await daemon.stop(); });

test("call returns the rc result body", async () => {
  const out = await client.call<{ version: string }>("core/version");
  expect(out.version).toMatch(/^v1\./);
});

test("call throws RcError on a bad rc path", async () => {
  await expect(client.call("does/notexist")).rejects.toBeInstanceOf(RcError);
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm --workspace server run test client`
Expected: 2 passing tests.

- [ ] **Step 4: Commit**

```bash
git add server/src/rclone/client.ts server/test/client.test.ts
git commit -m "feat(server): typed rc client with error mapping"
```

---

## Task 7: rclone types and providers service

**Files:**
- Create: `server/src/rclone/types.ts`, `server/src/rclone/providers.ts`
- Create: `server/src/routes/providers.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/providers.test.ts`

- [ ] **Step 1: Write the shared types**

Create `server/src/rclone/types.ts`:

```ts
export interface RcOptionExample {
  Value: string;
  Help: string;
  Provider?: string;
}

export interface RcOption {
  Name: string;
  FieldName: string;
  Help: string;
  Groups?: string;
  Provider?: string;
  Default: unknown;
  DefaultStr: string;
  Value: unknown;
  ValueStr: string;
  Type: string;
  Examples?: RcOptionExample[];
  ShortOpt?: string;
  Hide: number;
  Required: boolean;
  IsPassword: boolean;
  NoPrefix: boolean;
  Advanced: boolean;
  Exclusive: boolean;
  Sensitive: boolean;
}

export interface RcProvider {
  Name: string;
  Description: string;
  Prefix?: string;
  Options: RcOption[];
  Aliases?: string[] | null;
  Hide: boolean;
}

export interface RemoteSummary {
  name: string;
  type: string;
  parameters: Record<string, string>;
}

/** ConfigOut from the interactive config state-machine (config/create, nonInteractive). */
export interface ConfigOut {
  State?: string;
  Option?: RcOption & { Value?: unknown };
  Error?: string;
  Result?: string;
}
```

- [ ] **Step 2: Write the providers service with caching**

Create `server/src/rclone/providers.ts`:

```ts
import type { RcClient } from "./client.js";
import type { RcProvider } from "./types.js";

export class ProvidersService {
  private cache: RcProvider[] | null = null;

  constructor(private readonly client: RcClient) {}

  async list(): Promise<RcProvider[]> {
    if (this.cache) return this.cache;
    const out = await this.client.call<{ providers: RcProvider[] }>("config/providers");
    this.cache = out.providers.filter((p) => !p.Hide);
    return this.cache;
  }

  /** Drop the cache (call after an rclone binary update). */
  invalidate(): void {
    this.cache = null;
  }
}
```

- [ ] **Step 3: Write the providers route**

Create `server/src/routes/providers.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ProvidersService } from "../rclone/providers.js";

export function providersRoutes(providers: ProvidersService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/providers", async () => ({ providers: await providers.list() }));
  };
}
```

- [ ] **Step 4: Wire it into `app.ts`**

Replace `server/src/app.ts` with:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";
import { providersRoutes } from "./routes/providers.js";
import type { ProvidersService } from "./rclone/providers.js";

export interface BuildAppDeps {
  providers?: ProvidersService;
}

export async function buildApp(deps: BuildAppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(healthRoutes);
  if (deps.providers) await app.register(providersRoutes(deps.providers));
  return app;
}
```

- [ ] **Step 5: Write the failing test**

Create `server/test/providers.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { ProvidersService } from "../src/rclone/providers.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  const providers = new ProvidersService(new RcClient(daemon));
  app = await buildApp({ providers });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("GET /api/providers includes local with option metadata", async () => {
  const res = await app.inject({ method: "GET", url: "/api/providers" });
  expect(res.statusCode).toBe(200);
  const { providers } = res.json() as { providers: Array<{ Name: string; Options: unknown[] }> };
  const local = providers.find((p) => p.Name === "local");
  expect(local).toBeTruthy();
  // S3 carries Help, Default and Examples used to render fields/tooltips.
  const s3 = providers.find((p) => p.Name === "s3");
  expect(s3).toBeTruthy();
  expect(Array.isArray(s3!.Options)).toBe(true);
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm --workspace server run test providers`
Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add server/src/rclone/types.ts server/src/rclone/providers.ts server/src/routes/providers.ts server/src/app.ts server/test/providers.test.ts
git commit -m "feat(server): expose GET /api/providers from config/providers (cached)"
```

---

## Task 8: Remote service and list endpoint

**Files:**
- Create: `server/src/rclone/remotes.ts`
- Create: `server/src/routes/remotes.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/remotes-list.test.ts`

- [ ] **Step 1: Write the remote service (list only for this task)**

Create `server/src/rclone/remotes.ts`:

```ts
import type { RcClient } from "./client.js";
import type { ConfigOut, RemoteSummary } from "./types.js";

export class RemoteService {
  constructor(private readonly client: RcClient) {}

  async list(): Promise<RemoteSummary[]> {
    const { remotes } = await this.client.call<{ remotes: string[] }>("config/listremotes");
    const dump = await this.client.call<Record<string, Record<string, string>>>("config/dump");
    return remotes.map((name) => {
      const params = dump[name] ?? {};
      const { type = "unknown", ...rest } = params;
      return { name, type, parameters: rest };
    });
  }

  async create(
    name: string,
    type: string,
    parameters: Record<string, string>,
  ): Promise<ConfigOut | null> {
    return this.client.call<ConfigOut | null>("config/create", {
      name,
      type,
      parameters,
      opt: { obscure: true, nonInteractive: true },
    });
  }

  async continueConfig(
    name: string,
    state: string,
    result: string,
  ): Promise<ConfigOut | null> {
    return this.client.call<ConfigOut | null>("config/create", {
      name,
      parameters: {},
      opt: { obscure: true, nonInteractive: true, continue: true, state, result },
    });
  }

  async update(name: string, parameters: Record<string, string>): Promise<void> {
    await this.client.call("config/update", {
      name,
      parameters,
      opt: { obscure: true, nonInteractive: true },
    });
  }

  async delete(name: string): Promise<void> {
    await this.client.call("config/delete", { name });
  }

  /** Lightweight connectivity check: try about, fall back to listing the root. */
  async test(name: string): Promise<{ ok: boolean; detail?: string }> {
    const fs = `${name}:`;
    try {
      await this.client.call("operations/about", { fs });
      return { ok: true };
    } catch (aboutErr) {
      try {
        await this.client.call("operations/list", { fs, remote: "", opt: { recurse: false } });
        return { ok: true };
      } catch (listErr) {
        return { ok: false, detail: (listErr as Error).message || (aboutErr as Error).message };
      }
    }
  }
}
```

- [ ] **Step 2: Write the remotes route (list only for this task)**

Create `server/src/routes/remotes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { RemoteService } from "../rclone/remotes.js";

export function remotesRoutes(remotes: RemoteService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/remotes", async () => ({ remotes: await remotes.list() }));
  };
}
```

- [ ] **Step 3: Wire into `app.ts`**

Replace `server/src/app.ts` with:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";
import { providersRoutes } from "./routes/providers.js";
import { remotesRoutes } from "./routes/remotes.js";
import type { ProvidersService } from "./rclone/providers.js";
import type { RemoteService } from "./rclone/remotes.js";

export interface BuildAppDeps {
  providers?: ProvidersService;
  remotes?: RemoteService;
}

export async function buildApp(deps: BuildAppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(healthRoutes);
  if (deps.providers) await app.register(providersRoutes(deps.providers));
  if (deps.remotes) await app.register(remotesRoutes(deps.remotes));
  return app;
}
```

- [ ] **Step 4: Write the failing test**

Create `server/test/remotes-list.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
let svc: RemoteService;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  svc = new RemoteService(new RcClient(daemon));
  app = await buildApp({ remotes: svc });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("created remote appears in GET /api/remotes with its type", async () => {
  await svc.create("unit_local", "local", {});
  const res = await app.inject({ method: "GET", url: "/api/remotes" });
  expect(res.statusCode).toBe(200);
  const { remotes } = res.json() as { remotes: Array<{ name: string; type: string }> };
  const found = remotes.find((r) => r.name === "unit_local");
  expect(found).toEqual(expect.objectContaining({ name: "unit_local", type: "local" }));
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm --workspace server run test remotes-list`
Expected: 1 passing test.

- [ ] **Step 6: Commit**

```bash
git add server/src/rclone/remotes.ts server/src/routes/remotes.ts server/src/app.ts server/test/remotes-list.test.ts
git commit -m "feat(server): RemoteService + GET /api/remotes"
```

---

## Task 9: Create, update, delete, continue, and test endpoints

The `RemoteService` methods already exist (Task 8). This task adds the routes and validation.

**Files:**
- Modify: `server/src/routes/remotes.ts`
- Test: `server/test/remotes-crud.test.ts`

- [ ] **Step 1: Extend the remotes route with CRUD + continue + test**

Replace `server/src/routes/remotes.ts` with:

```ts
import type { FastifyInstance } from "fastify";
import type { RemoteService } from "../rclone/remotes.js";

interface CreateBody {
  name: string;
  type: string;
  parameters?: Record<string, string>;
}
interface UpdateBody {
  parameters: Record<string, string>;
}
interface ContinueBody {
  state: string;
  result: string;
}

const NAME_RE = /^[\w.+@-]+$/; // rclone-legal remote names

export function remotesRoutes(remotes: RemoteService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/remotes", async () => ({ remotes: await remotes.list() }));

    app.post<{ Body: CreateBody }>("/api/remotes", async (req, reply) => {
      const { name, type, parameters = {} } = req.body ?? ({} as CreateBody);
      if (!name || !NAME_RE.test(name)) return reply.code(400).send({ error: "invalid remote name" });
      if (!type) return reply.code(400).send({ error: "type is required" });
      const configOut = await remotes.create(name, type, parameters);
      // Empty/no State => done; otherwise an interactive step (e.g. OAuth) is pending.
      if (configOut && configOut.State) return reply.code(200).send({ pending: configOut });
      return reply.code(201).send({ created: name });
    });

    app.post<{ Params: { name: string }; Body: ContinueBody }>(
      "/api/remotes/:name/continue",
      async (req, reply) => {
        const { name } = req.params;
        const { state, result } = req.body ?? ({} as ContinueBody);
        const configOut = await remotes.continueConfig(name, state, result);
        if (configOut && configOut.State) return reply.code(200).send({ pending: configOut });
        return reply.code(200).send({ created: name });
      },
    );

    app.put<{ Params: { name: string }; Body: UpdateBody }>(
      "/api/remotes/:name",
      async (req, reply) => {
        await remotes.update(req.params.name, req.body?.parameters ?? {});
        return reply.code(200).send({ updated: req.params.name });
      },
    );

    app.delete<{ Params: { name: string } }>("/api/remotes/:name", async (req, reply) => {
      await remotes.delete(req.params.name);
      return reply.code(200).send({ deleted: req.params.name });
    });

    app.post<{ Params: { name: string } }>("/api/remotes/:name/test", async (req) => {
      return remotes.test(req.params.name);
    });
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `server/test/remotes-crud.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  app = await buildApp({ remotes: new RemoteService(new RcClient(daemon)) });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("rejects an invalid remote name", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/remotes",
    payload: { name: "bad name!", type: "local" },
  });
  expect(res.statusCode).toBe(400);
});

test("create -> update -> test -> delete a local remote", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rg-target-"));

  const created = await app.inject({
    method: "POST", url: "/api/remotes",
    payload: { name: "crud_local", type: "local", parameters: {} },
  });
  expect(created.statusCode).toBe(201);

  const updated = await app.inject({
    method: "PUT", url: "/api/remotes/crud_local",
    payload: { parameters: { nounc: "true" } },
  });
  expect(updated.statusCode).toBe(200);

  // A local remote pointed at a real dir tests successfully.
  await app.inject({
    method: "POST", url: "/api/remotes",
    payload: { name: "crud_test", type: "local", parameters: {} },
  });
  const test = await app.inject({ method: "POST", url: `/api/remotes/crud_test/test` });
  expect(test.statusCode).toBe(200);
  // local backend supports about, so ok should be true
  expect((test.json() as { ok: boolean }).ok).toBe(true);
  void dir;

  const del = await app.inject({ method: "DELETE", url: "/api/remotes/crud_local" });
  expect(del.statusCode).toBe(200);

  const list = await app.inject({ method: "GET", url: "/api/remotes" });
  const names = (list.json() as { remotes: Array<{ name: string }> }).remotes.map((r) => r.name);
  expect(names).not.toContain("crud_local");
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm --workspace server run test remotes-crud`
Expected: 2 passing tests.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/remotes.ts server/test/remotes-crud.test.ts
git commit -m "feat(server): create/update/delete/continue/test remote endpoints"
```

---

## Task 10: Optional password auth gate

When `GUI_PASSWORD` is set, gate every `/api/*` route (except health and login) behind a signed-cookie session. When unset, the API is open and reports `protected: false` so the UI can show a warning banner.

**Files:**
- Create: `server/src/auth/gate.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/auth.test.ts`

- [ ] **Step 1: Write the auth gate**

Create `server/src/auth/gate.ts`:

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const COOKIE = "rg_session";

function sign(secret: string): string {
  return createHmac("sha256", secret).update("authenticated").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface AuthGate {
  password: string | null;
  register(app: FastifyInstance): Promise<void>;
}

export function createAuthGate(password: string | null): AuthGate {
  const secret = randomBytes(32).toString("hex");
  const token = sign(secret);

  return {
    password,
    async register(app: FastifyInstance): Promise<void> {
      // Status endpoint: tells the UI whether auth is on and whether this session is in.
      app.get("/api/auth/status", async (req: FastifyRequest) => {
        const authed = !password || req.cookies[COOKIE] === token;
        return { protected: Boolean(password), authenticated: authed };
      });

      app.post<{ Body: { password?: string } }>("/api/auth/login", async (req, reply) => {
        if (!password) return reply.code(200).send({ authenticated: true });
        const supplied = req.body?.password ?? "";
        if (safeEqual(supplied, password)) {
          reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
          return reply.code(200).send({ authenticated: true });
        }
        return reply.code(401).send({ error: "invalid password" });
      });

      if (!password) return; // open mode: no guard installed

      app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
        const url = req.url.split("?")[0];
        if (
          url === "/api/health" ||
          url === "/api/auth/status" ||
          url === "/api/auth/login" ||
          !url.startsWith("/api/")
        ) {
          return; // public routes + static assets
        }
        if (req.cookies[COOKIE] !== token) {
          return reply.code(401).send({ error: "authentication required" });
        }
      });
    },
  };
}
```

- [ ] **Step 2: Wire into `app.ts`**

Replace `server/src/app.ts` with:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { healthRoutes } from "./routes/health.js";
import { providersRoutes } from "./routes/providers.js";
import { remotesRoutes } from "./routes/remotes.js";
import { createAuthGate } from "./auth/gate.js";
import type { ProvidersService } from "./rclone/providers.js";
import type { RemoteService } from "./rclone/remotes.js";

export interface BuildAppDeps {
  providers?: ProvidersService;
  remotes?: RemoteService;
  guiPassword?: string | null;
}

export async function buildApp(deps: BuildAppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await createAuthGate(deps.guiPassword ?? null).register(app);
  await app.register(healthRoutes);
  if (deps.providers) await app.register(providersRoutes(deps.providers));
  if (deps.remotes) await app.register(remotesRoutes(deps.remotes));
  return app;
}
```

- [ ] **Step 3: Write the failing test**

Create `server/test/auth.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
afterEach(async () => { if (app) await app.close(); });

test("open mode: status reports unprotected and /api is reachable", async () => {
  app = await buildApp({ guiPassword: null });
  const status = await app.inject({ method: "GET", url: "/api/auth/status" });
  expect(status.json()).toEqual({ protected: false, authenticated: true });
});

test("protected mode: blocks until login, then allows with cookie", async () => {
  app = await buildApp({ guiPassword: "s3cret" });

  const blocked = await app.inject({ method: "GET", url: "/api/remotes" });
  expect(blocked.statusCode).toBe(401);

  const badLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "nope" } });
  expect(badLogin.statusCode).toBe(401);

  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "s3cret" } });
  expect(login.statusCode).toBe(200);
  const cookie = login.cookies[0];
  expect(cookie.name).toBe("rg_session");

  const allowed = await app.inject({
    method: "GET", url: "/api/remotes",
    cookies: { [cookie.name]: cookie.value },
  });
  // No remotes service registered here, so 404 (route absent) — but NOT 401.
  expect(allowed.statusCode).not.toBe(401);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server run test auth`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/gate.ts server/src/app.ts server/test/auth.test.ts
git commit -m "feat(server): optional GUI_PASSWORD auth gate with signed cookie session"
```

---

## Task 11: Server bootstrap (wire daemon lifecycle and listen)

Tie the pieces together: resolve the binary, start the daemon, build the app with all services, listen, and shut the daemon down on exit. Static SPA serving is added in Plan 3 once `web/dist` exists; for now serve a placeholder JSON at `/`.

**Files:**
- Create: `server/src/index.ts`
- Test: `server/test/bootstrap.test.ts`

- [ ] **Step 1: Write the bootstrap**

Create `server/src/index.ts`:

```ts
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { resolveRcloneBinary } from "./rclone/resolveBinary.js";
import { RcloneDaemon } from "./rclone/daemon.js";
import { RcClient } from "./rclone/client.js";
import { ProvidersService } from "./rclone/providers.js";
import { RemoteService } from "./rclone/remotes.js";
import { buildApp } from "./app.js";

export async function main(): Promise<void> {
  const cfg = loadConfig();
  await mkdir(path.dirname(cfg.rcloneConfigPath), { recursive: true });

  const binary = resolveRcloneBinary({ override: cfg.rcloneBinary, configDir: cfg.configDir });
  const daemon = new RcloneDaemon({ binary, configPath: cfg.rcloneConfigPath });
  await daemon.start();

  const client = new RcClient(daemon);
  const app = await buildApp({
    providers: new ProvidersService(client),
    remotes: new RemoteService(client),
    guiPassword: cfg.guiPassword,
  });

  const shutdown = async () => {
    await app.close();
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: cfg.port, host: cfg.host });
  // eslint-disable-next-line no-console
  console.log(`rclone-gui listening on http://${cfg.host}:${cfg.port}`);
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Write the failing end-to-end test**

Create `server/test/bootstrap.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { ProvidersService } from "../src/rclone/providers.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { resolveRcloneBinary } from "../src/rclone/resolveBinary.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rg-boot-"));
  const configPath = path.join(dir, "rclone.conf");
  await writeFile(configPath, "", "utf8");
  const binary = resolveRcloneBinary({ cwd: path.resolve(__dirname, "../..") });
  daemon = new RcloneDaemon({ binary, configPath });
  await daemon.start();
  const client = new RcClient(daemon);
  app = await buildApp({
    providers: new ProvidersService(client),
    remotes: new RemoteService(client),
    guiPassword: null,
  });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("full app: health + providers + empty remotes wired together", async () => {
  expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  expect((await app.inject({ method: "GET", url: "/api/providers" })).statusCode).toBe(200);
  const remotes = await app.inject({ method: "GET", url: "/api/remotes" });
  expect(remotes.statusCode).toBe(200);
  expect(remotes.json()).toEqual({ remotes: [] });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm --workspace server run test bootstrap`
Expected: 1 passing test.

- [ ] **Step 4: Run the full suite**

Run: `npm --workspace server run test`
Expected: all tests across health, resolveBinary, daemon, client, providers, remotes-list, remotes-crud, auth, bootstrap pass.

- [ ] **Step 5: Manual smoke check**

Run:
```bash
RCLONE_GUI_CONFIG_DIR="$(mktemp -d)" PORT=3000 npm --workspace server run dev
```
In another shell:
```bash
curl -s localhost:3000/api/health
curl -s localhost:3000/api/providers | head -c 200
```
Expected: `{"status":"ok"}` and a JSON providers payload. Ctrl-C to stop (daemon shuts down).

- [ ] **Step 6: Commit**

```bash
git add server/src/index.ts server/test/bootstrap.test.ts
git commit -m "feat(server): bootstrap daemon lifecycle + listen"
```

---

## Self-review notes (author check against the spec)

- **Auto-discovered options w/ tooltips & defaults** → `GET /api/providers` returns rclone's full `RcOption` metadata (`Help`, `DefaultStr`, `Examples`, `Required`, `Advanced`, `IsPassword`, `Sensitive`, `Provider`, `Groups`); rendering is Plan 2.
- **Supervised localhost-only rcd with random creds** → Task 5 (`RcloneDaemon`), auth verified by the "rejected without auth" test.
- **CRUD + test + OAuth-capable interactive path** → Tasks 8–9 (`config/create` with `nonInteractive`/`obscure`, `/continue` for the state-machine, `/test` via `operations/about` with list fallback).
- **Optional auth, off by default, with status for the banner** → Task 10.
- **Persistence at `/config/rclone.conf`** → `config.ts` default + bootstrap `mkdir`.
- **rclone binary resolution incl. self-updated `/config/bin/rclone`** → Task 4 (the updater that writes there is Plan 3).
- **Removal of forked rclone source** → Task 1.

Deferred to later plans (correctly out of this plan's scope): SPA build & static serving, `OptionField`/wizard UI, Dockerfile + pinned-binary baking, runtime version self-updater + Settings UI.

---

## Execution handoff

This plan is self-contained and testable. After it lands, Plan 2 (Frontend) and Plan 3 (Packaging & version updater) follow.
