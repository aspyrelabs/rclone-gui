# rclone GUI — Stage 3 Plan A: Backend (Serve & Mounts)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Backend services + REST endpoints to manage `rclone serve` instances (start/list/stop/types) and `rclone mount`s (mount/list/unmount/types), proxied through the rc API.

**Architecture:** Two thin services over the existing `RcClient`, plus Fastify routes, wired into `buildApp`/bootstrap sharing the one `RcClient`. Serve/mount instances live in the supervised `rcd` process.

**Tech Stack:** unchanged (Fastify, TS ESM, Vitest; real `rcd` for serve tests, mocked `RcClient` for mount tests).

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-3-design.md`
**Builds on:** Stages 1–2 (merged). Existing: `RcClient.call<T>(rcPath, params)`, `buildApp(deps)`, `startTestDaemon()`, `RemoteService.create`, `fsString(remote, path)` in `server/src/rclone/browse.ts`.

## Verified rc shapes (rclone v1.74.3)
- `serve/types` → `{ types: string[] }` (`dlna,ftp,http,nfs,restic,s3,sftp,webdav`)
- `serve/start {type, fs, addr?, opt?}` → `{ id, addr }`
- `serve/list` → `{ list: [{ id, addr, params: { type, fs, addr } }] }`
- `serve/stop {id}`
- `mount/types` → `{ mountTypes: string[] }`
- `mount/mount {fs, mountPoint, mountType?}` → `{}`
- `mount/listmounts` → `{ mountPoints: [{ Fs, MountPoint }] }`
- `mount/unmount {mountPoint}`

---

## File structure introduced

```
server/src/
  rclone/serve.ts     # ServeService
  rclone/mounts.ts    # MountService
  routes/serve.ts     # /api/serve (+ /types, /:id/stop)
  routes/mounts.ts    # /api/mounts (+ /types, /unmount)
  app.ts              # wire serve + mounts
  index.ts            # construct services
server/test/
  serve.test.ts       # real rcd
  mounts.test.ts      # mocked RcClient + live mount/types
```

---

## Task 1: ServeService + serve routes

**Files:** Create `server/src/rclone/serve.ts`, `server/src/routes/serve.ts`; modify `server/src/app.ts`, `server/src/index.ts`; create `server/test/serve.test.ts`.

- [ ] **Step 1: `server/src/rclone/serve.ts`**

```ts
import type { RcClient } from "./client.js";
import { fsString } from "./browse.js";

export interface ServeInstance {
  id: string;
  addr: string;
  type: string;
  fs: string;
}

export class ServeService {
  constructor(private readonly client: RcClient) {}

  async types(): Promise<string[]> {
    const out = await this.client.call<{ types: string[] }>("serve/types");
    return out.types ?? [];
  }

  async start(
    type: string,
    remote: string,
    path: string,
    addr?: string,
    opt?: Record<string, unknown>,
  ): Promise<{ id: string; addr: string }> {
    const params: Record<string, unknown> = { type, fs: fsString(remote, path) };
    if (addr) params.addr = addr;
    if (opt) params.opt = opt;
    return this.client.call<{ id: string; addr: string }>("serve/start", params);
  }

  async list(): Promise<ServeInstance[]> {
    const out = await this.client.call<{
      list?: Array<{ id: string; addr: string; params?: { type?: string; fs?: string } }>;
    }>("serve/list");
    return (out.list ?? []).map((s) => ({
      id: s.id,
      addr: s.addr,
      type: s.params?.type ?? "",
      fs: s.params?.fs ?? "",
    }));
  }

  async stop(id: string): Promise<void> {
    await this.client.call("serve/stop", { id });
  }
}
```

- [ ] **Step 2: `server/src/routes/serve.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ServeService } from "../rclone/serve.js";

interface StartBody {
  type: string;
  remote: string;
  path?: string;
  addr?: string;
  opt?: Record<string, unknown>;
}

export function serveRoutes(serve: ServeService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/serve/types", async () => ({ types: await serve.types() }));
    app.get("/api/serve", async () => ({ serves: await serve.list() }));

    app.post<{ Body: StartBody }>("/api/serve", async (req, reply) => {
      const b = req.body ?? ({} as StartBody);
      if (!b.type || !b.remote) return reply.code(400).send({ error: "type and remote are required", status: 400 });
      return serve.start(b.type, b.remote, b.path ?? "", b.addr, b.opt);
    });

    app.post<{ Params: { id: string } }>("/api/serve/:id/stop", async (req, reply) => {
      if (!req.params.id) return reply.code(400).send({ error: "id is required", status: 400 });
      await serve.stop(req.params.id);
      return reply.code(200).send({ stopped: req.params.id });
    });
  };
}
```

- [ ] **Step 3: Wire into `server/src/app.ts`**

Add to `BuildAppDeps`: `serve?: ServeService;`
Add imports: `import { serveRoutes } from "./routes/serve.js";` and `import type { ServeService } from "./rclone/serve.js";`
Register before static: `if (deps.serve) await app.register(serveRoutes(deps.serve));`

- [ ] **Step 4: Construct in `server/src/index.ts`**

Add `import { ServeService } from "./rclone/serve.js";`, `const serve = new ServeService(client);`, and pass `serve,` to `buildApp({...})`.

- [ ] **Step 5: Create `server/test/serve.test.ts`**

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { ServeService } from "../src/rclone/serve.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  const client = new RcClient(daemon);
  await new RemoteService(client).create("loc", "local", {});
  app = await buildApp({ serve: new ServeService(client) });
  dir = await mkdtemp(path.join(os.tmpdir(), "rg-serve-"));
  await writeFile(path.join(dir, "hello.txt"), "served-content", "utf8");
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("serve/types lists http", async () => {
  const res = await app.inject({ method: "GET", url: "/api/serve/types" });
  expect(res.statusCode).toBe(200);
  expect((res.json() as { types: string[] }).types).toContain("http");
});

test("start an http serve, fetch a file from it, then stop it", async () => {
  const start = await app.inject({
    method: "POST", url: "/api/serve",
    payload: { type: "http", remote: "loc", path: dir, addr: "127.0.0.1:0" },
  });
  expect(start.statusCode).toBe(200);
  const { id, addr } = start.json() as { id: string; addr: string };
  expect(id).toMatch(/^http-/);
  expect(addr).toMatch(/127\.0\.0\.1:\d+/);

  // it appears in the list
  const listed = (await app.inject({ method: "GET", url: "/api/serve" })).json() as { serves: Array<{ id: string; type: string }> };
  expect(listed.serves.find((s) => s.id === id)).toMatchObject({ type: "http" });

  // the served content is fetchable from the resolved address
  const resp = await fetch(`http://${addr}/hello.txt`);
  expect(await resp.text()).toContain("served-content");

  // stop it
  const stop = await app.inject({ method: "POST", url: `/api/serve/${id}/stop` });
  expect(stop.statusCode).toBe(200);
  const after = (await app.inject({ method: "GET", url: "/api/serve" })).json() as { serves: Array<{ id: string }> };
  expect(after.serves.find((s) => s.id === id)).toBeUndefined();
});

test("missing type is a 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/serve", payload: { remote: "loc" } });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 6: Run** `npm --workspace server run test serve` → 3 passing. Full suite green. `npx tsc --noEmit -p server/tsconfig.json` clean. No leftover rcd (`pgrep -fl "rclone rcd" || echo none`).

- [ ] **Step 7: Commit**

```bash
git add server/src/rclone/serve.ts server/src/routes/serve.ts server/src/app.ts server/src/index.ts server/test/serve.test.ts
git commit -m "feat(server): serve service + start/list/stop/types endpoints"
```

---

## Task 2: MountService + mount routes

**Files:** Create `server/src/rclone/mounts.ts`, `server/src/routes/mounts.ts`; modify `server/src/app.ts`, `server/src/index.ts`; create `server/test/mounts.test.ts`.

- [ ] **Step 1: `server/src/rclone/mounts.ts`**

```ts
import type { RcClient } from "./client.js";
import { fsString } from "./browse.js";

export interface MountInstance {
  fs: string;
  mountPoint: string;
}

export class MountService {
  constructor(private readonly client: RcClient) {}

  async types(): Promise<string[]> {
    const out = await this.client.call<{ mountTypes: string[] }>("mount/types");
    return out.mountTypes ?? [];
  }

  async mount(remote: string, path: string, mountPoint: string, mountType?: string): Promise<void> {
    const params: Record<string, unknown> = { fs: fsString(remote, path), mountPoint };
    if (mountType) params.mountType = mountType;
    await this.client.call("mount/mount", params);
  }

  async list(): Promise<MountInstance[]> {
    const out = await this.client.call<{ mountPoints?: Array<{ Fs?: string; MountPoint?: string }> }>("mount/listmounts");
    return (out.mountPoints ?? []).map((m) => ({ fs: m.Fs ?? "", mountPoint: m.MountPoint ?? "" }));
  }

  async unmount(mountPoint: string): Promise<void> {
    await this.client.call("mount/unmount", { mountPoint });
  }
}
```

- [ ] **Step 2: `server/src/routes/mounts.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { MountService } from "../rclone/mounts.js";

interface MountBody { remote: string; path?: string; mountPoint: string; mountType?: string; }
interface UnmountBody { mountPoint: string; }

export function mountsRoutes(mounts: MountService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/mounts/types", async () => ({ types: await mounts.types() }));
    app.get("/api/mounts", async () => ({ mounts: await mounts.list() }));

    app.post<{ Body: MountBody }>("/api/mounts", async (req, reply) => {
      const b = req.body ?? ({} as MountBody);
      if (!b.remote || !b.mountPoint) return reply.code(400).send({ error: "remote and mountPoint are required", status: 400 });
      await mounts.mount(b.remote, b.path ?? "", b.mountPoint, b.mountType);
      return reply.code(201).send({ mounted: b.mountPoint });
    });

    app.post<{ Body: UnmountBody }>("/api/mounts/unmount", async (req, reply) => {
      const b = req.body ?? ({} as UnmountBody);
      if (!b.mountPoint) return reply.code(400).send({ error: "mountPoint is required", status: 400 });
      await mounts.unmount(b.mountPoint);
      return reply.code(200).send({ unmounted: b.mountPoint });
    });
  };
}
```

- [ ] **Step 3: Wire into `server/src/app.ts`**

Add to `BuildAppDeps`: `mounts?: MountService;`
Add imports: `import { mountsRoutes } from "./routes/mounts.js";` and `import type { MountService } from "./rclone/mounts.js";`
Register before static: `if (deps.mounts) await app.register(mountsRoutes(deps.mounts));`

- [ ] **Step 4: Construct in `server/src/index.ts`**

Add `import { MountService } from "./rclone/mounts.js";`, `const mounts = new MountService(client);`, pass `mounts,` to `buildApp({...})`.

- [ ] **Step 5: Create `server/test/mounts.test.ts`**

This test uses a real `rcd` for `mount/types` (works without FUSE) and a mocked `RcClient` to verify the mount/unmount/list rc calls are built correctly (a real FUSE mount can't run in CI).

```ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { MountService } from "../src/rclone/mounts.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

// ---- live mount/types against a real rcd ----
let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  app = await buildApp({ mounts: new MountService(new RcClient(daemon)) });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("GET /api/mounts/types returns the supported mount types", async () => {
  const res = await app.inject({ method: "GET", url: "/api/mounts/types" });
  expect(res.statusCode).toBe(200);
  expect(Array.isArray((res.json() as { types: string[] }).types)).toBe(true);
});

test("GET /api/mounts lists current mounts (none initially)", async () => {
  const res = await app.inject({ method: "GET", url: "/api/mounts" });
  expect(res.statusCode).toBe(200);
  expect((res.json() as { mounts: unknown[] }).mounts).toEqual([]);
});

// ---- mount/unmount call construction with a mocked client (no FUSE needed) ----
test("MountService builds the correct rc calls", async () => {
  const calls: Array<{ path: string; params: unknown }> = [];
  const fakeClient = {
    call: vi.fn(async (path: string, params: unknown) => {
      calls.push({ path, params });
      if (path === "mount/listmounts") return { mountPoints: [{ Fs: "loc:/data", MountPoint: "/mnt/x" }] };
      return {};
    }),
  } as unknown as RcClient;
  const svc = new MountService(fakeClient);

  await svc.mount("loc", "data", "/mnt/x", "nfsmount");
  expect(calls[0]).toEqual({ path: "mount/mount", params: { fs: "loc:data", mountPoint: "/mnt/x", mountType: "nfsmount" } });

  const list = await svc.list();
  expect(list).toEqual([{ fs: "loc:/data", mountPoint: "/mnt/x" }]);

  await svc.unmount("/mnt/x");
  expect(calls[calls.length - 1]).toEqual({ path: "mount/unmount", params: { mountPoint: "/mnt/x" } });
});

test("missing mountPoint is a 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/mounts", payload: { remote: "loc" } });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 6: Run** `npm --workspace server run test mounts` → 4 passing. Full suite green. `tsc --noEmit` clean. No leftover rcd.

- [ ] **Step 7: Commit**

```bash
git add server/src/rclone/mounts.ts server/src/routes/mounts.ts server/src/app.ts server/src/index.ts server/test/mounts.test.ts
git commit -m "feat(server): mount service + mount/list/unmount/types endpoints"
```

---

## Self-review notes (author check against the spec)
- **Serve start/list/stop/types** → `ServeService` + routes (Task 1), tested by actually fetching content from a started http serve.
- **Mount mount/list/unmount/types** → `MountService` + routes (Task 2); FUSE-dependent paths unit-tested with a mocked client; `mount/types` + empty `list` validated live.
- **fs convention** reuses Stage 2 `fsString`.
- **Process-lifetime instances**: inherent to rclone's rc serve/mount (no persistence added) — matches the spec.

## Execution handoff
Plan B (frontend: Serve page, Mounts page with the FUSE-privileges note, nav enablement) builds on these endpoints.
