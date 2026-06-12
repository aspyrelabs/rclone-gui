# rclone GUI — Stage 2 Plan A: Backend (Browse & Jobs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add backend services + REST endpoints to browse a remote's directories, run basic file operations (mkdir, delete), and launch/monitor/stop copy & move jobs with live progress.

**Architecture:** Two new services over the existing `RcClient`, plus thin Fastify routes, wired into `buildApp`/bootstrap alongside the Stage 1 services (sharing the one `RcClient`). Transfers run as async rc jobs (`_async:true` + a generated `_group`); progress comes from `job/status` + `core/stats {group}`.

**Tech Stack:** unchanged (Fastify, TS ESM, Vitest, real `rcd` in tests).

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-2-design.md`
**Builds on:** Stage 1 backend (merged). Existing: `RcClient.call<T>(rcPath, params)`, `buildApp(deps)`, `server/test/helpers/rcd.ts` (`startTestDaemon()`), `RemoteService` (has `create`).

## Verified rc conventions (rclone v1.74.3 — probed live)

- **List:** `operations/list {fs: "<remote>:<path>", remote: ""}` → `{ list: [{Path,Name,Size,ModTime,IsDir,MimeType}] }`. (Path-in-fs form is used because it works uniformly for cloud remotes AND local-absolute paths.)
- **mkdir:** `operations/mkdir {fs: "<remote>:<parentPath>", remote: "<name>"}`.
- **delete file:** `operations/deletefile {fs: "<remote>:<parentPath>", remote: "<name>"}`.
- **delete dir (recursive):** `operations/purge {fs: "<remote>:<parentPath>", remote: "<name>"}`.
- **copy/move a directory (async):** `sync/copy` | `sync/move {srcFs: "<r>:<fullPath>", dstFs: "<r>:<fullPath>", _async:true, _group:"<g>"}` → `{ jobid }`.
- **copy/move a file (async):** `operations/copyfile` | `operations/movefile {srcFs:"<r>:<parent>", srcRemote:"<name>", dstFs:"<r>:<parent>", dstRemote:"<name>", _async:true, _group:"<g>"}` → `{ jobid }`.
- **job lifecycle:** `job/status {jobid}` → `{ id, finished, success, error, duration }`; `job/stop {jobid}`.
- **progress:** `core/stats {group}` → `{ bytes, totalBytes, transfers, totalTransfers, speed, eta, errors }`.

A path string joins with `/`; the remote root is `path === ""`.

---

## File structure introduced by this plan

```
server/src/
  rclone/browse.ts        # BrowseService: list / mkdir / deletePath
  rclone/jobs.ts          # JobService: launch / list / stop (async copy/move + stats)
  routes/browse.ts        # GET /api/browse, POST /api/browse/mkdir, POST /api/browse/delete
  routes/jobs.ts          # POST /api/jobs, GET /api/jobs, POST /api/jobs/:id/stop
  app.ts                  # wire browse + jobs routes
  index.ts                # construct BrowseService + JobService
server/test/
  browse.test.ts
  jobs.test.ts
```

---

## Task 1: BrowseService + browse routes

**Files:**
- Create: `server/src/rclone/browse.ts`, `server/src/routes/browse.ts`
- Modify: `server/src/app.ts`, `server/src/index.ts`
- Test: `server/test/browse.test.ts`

- [ ] **Step 1: Create `server/src/rclone/browse.ts`**

```ts
import type { RcClient } from "./client.js";

export interface DirEntry {
  Path: string;
  Name: string;
  Size: number;
  ModTime: string;
  IsDir: boolean;
  MimeType: string;
}

/** Join a remote name + path into an rc fs string: `remote:path`. */
export function fsString(remote: string, path: string): string {
  return `${remote}:${path}`;
}

export class BrowseService {
  constructor(private readonly client: RcClient) {}

  /** List one directory level of `remote` at `path` ("" = root). */
  async list(remote: string, path: string): Promise<DirEntry[]> {
    const out = await this.client.call<{ list: DirEntry[] }>("operations/list", {
      fs: fsString(remote, path),
      remote: "",
    });
    return out.list ?? [];
  }

  /** Create directory `name` under `remote`:`parentPath`. */
  async mkdir(remote: string, parentPath: string, name: string): Promise<void> {
    await this.client.call("operations/mkdir", { fs: fsString(remote, parentPath), remote: name });
  }

  /** Delete `name` under `remote`:`parentPath`. Dirs are purged recursively. */
  async deletePath(remote: string, parentPath: string, name: string, isDir: boolean): Promise<void> {
    const rcPath = isDir ? "operations/purge" : "operations/deletefile";
    await this.client.call(rcPath, { fs: fsString(remote, parentPath), remote: name });
  }
}
```

- [ ] **Step 2: Create `server/src/routes/browse.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { BrowseService } from "../rclone/browse.js";

interface MkdirBody { remote: string; path: string; name: string; }
interface DeleteBody { remote: string; path: string; name: string; isDir: boolean; }

export function browseRoutes(browse: BrowseService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get<{ Querystring: { remote?: string; path?: string } }>("/api/browse", async (req, reply) => {
      const remote = req.query.remote;
      if (!remote) return reply.code(400).send({ error: "remote is required", status: 400 });
      const entries = await browse.list(remote, req.query.path ?? "");
      return { entries };
    });

    app.post<{ Body: MkdirBody }>("/api/browse/mkdir", async (req, reply) => {
      const { remote, path, name } = req.body ?? ({} as MkdirBody);
      if (!remote || !name) return reply.code(400).send({ error: "remote and name are required", status: 400 });
      await browse.mkdir(remote, path ?? "", name);
      return reply.code(201).send({ created: name });
    });

    app.post<{ Body: DeleteBody }>("/api/browse/delete", async (req, reply) => {
      const { remote, path, name, isDir } = req.body ?? ({} as DeleteBody);
      if (!remote || !name) return reply.code(400).send({ error: "remote and name are required", status: 400 });
      await browse.deletePath(remote, path ?? "", name, Boolean(isDir));
      return reply.code(200).send({ deleted: name });
    });
  };
}
```

- [ ] **Step 3: Wire into `server/src/app.ts`**

Add to `BuildAppDeps`: `browse?: BrowseService;`
Add import: `import { browseRoutes } from "./routes/browse.js";` and `import type { BrowseService } from "./rclone/browse.js";`
Register with the api routes (before static): `if (deps.browse) await app.register(browseRoutes(deps.browse));`

- [ ] **Step 4: Construct in `server/src/index.ts`**

Add import `import { BrowseService } from "./rclone/browse.js";`, create `const browse = new BrowseService(client);` (after `client` is created), and pass `browse,` in the `buildApp({...})` call.

- [ ] **Step 5: Write the failing test `server/test/browse.test.ts`**

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { BrowseService } from "../src/rclone/browse.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
let dir: string;
const REMOTE = "loc"; // a local remote; we address absolute temp paths as loc:<abs>

beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  const client = new RcClient(daemon);
  await new RemoteService(client).create(REMOTE, "local", {});
  app = await buildApp({ browse: new BrowseService(client) });

  dir = await mkdtemp(path.join(os.tmpdir(), "rg-browse-"));
  await writeFile(path.join(dir, "a.txt"), "hello", "utf8");
  await mkdir(path.join(dir, "sub"));
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("GET /api/browse lists entries with IsDir", async () => {
  const res = await app.inject({ method: "GET", url: `/api/browse?remote=${REMOTE}&path=${encodeURIComponent(dir)}` });
  expect(res.statusCode).toBe(200);
  const { entries } = res.json() as { entries: Array<{ Name: string; IsDir: boolean }> };
  expect(entries.find((e) => e.Name === "a.txt")).toMatchObject({ IsDir: false });
  expect(entries.find((e) => e.Name === "sub")).toMatchObject({ IsDir: true });
});

test("mkdir then delete a folder", async () => {
  const mk = await app.inject({ method: "POST", url: "/api/browse/mkdir", payload: { remote: REMOTE, path: dir, name: "made" } });
  expect(mk.statusCode).toBe(201);
  let listed = (await app.inject({ method: "GET", url: `/api/browse?remote=${REMOTE}&path=${encodeURIComponent(dir)}` })).json() as { entries: Array<{ Name: string }> };
  expect(listed.entries.some((e) => e.Name === "made")).toBe(true);

  const del = await app.inject({ method: "POST", url: "/api/browse/delete", payload: { remote: REMOTE, path: dir, name: "made", isDir: true } });
  expect(del.statusCode).toBe(200);
  listed = (await app.inject({ method: "GET", url: `/api/browse?remote=${REMOTE}&path=${encodeURIComponent(dir)}` })).json() as { entries: Array<{ Name: string }> };
  expect(listed.entries.some((e) => e.Name === "made")).toBe(false);
});

test("delete a file", async () => {
  await writeFile(path.join(dir, "gone.txt"), "x", "utf8");
  const del = await app.inject({ method: "POST", url: "/api/browse/delete", payload: { remote: REMOTE, path: dir, name: "gone.txt", isDir: false } });
  expect(del.statusCode).toBe(200);
  const listed = (await app.inject({ method: "GET", url: `/api/browse?remote=${REMOTE}&path=${encodeURIComponent(dir)}` })).json() as { entries: Array<{ Name: string }> };
  expect(listed.entries.some((e) => e.Name === "gone.txt")).toBe(false);
});

test("missing remote is a 400", async () => {
  const res = await app.inject({ method: "GET", url: "/api/browse" });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 6: Run** `npm --workspace server run test browse` → expect 4 passing tests. Then full suite green (`npm --workspace server run test`).

- [ ] **Step 7: Commit**

```bash
git add server/src/rclone/browse.ts server/src/routes/browse.ts server/src/app.ts server/src/index.ts server/test/browse.test.ts
git commit -m "feat(server): browse service + list/mkdir/delete endpoints"
```

---

## Task 2: JobService + jobs routes

**Files:**
- Create: `server/src/rclone/jobs.ts`, `server/src/routes/jobs.ts`
- Modify: `server/src/app.ts`, `server/src/index.ts`
- Test: `server/test/jobs.test.ts`

- [ ] **Step 1: Create `server/src/rclone/jobs.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { RcClient } from "./client.js";
import { fsString } from "./browse.js";

export type JobType = "copy" | "move";

/** A path reference: a remote, the parent directory path, and the leaf name. */
export interface PathRef {
  remote: string;
  path: string; // parent directory ("" = root)
  name: string; // leaf file/dir name
}

export interface LaunchInput {
  type: JobType;
  src: PathRef;
  dst: PathRef; // dst.name may rename; dst.path is the destination parent
  isDir: boolean;
}

export interface JobInfo {
  id: number;
  type: JobType;
  src: string; // human label, e.g. "remote:path/name"
  dst: string;
  finished: boolean;
  success: boolean;
  error: string;
  bytes: number;
  totalBytes: number;
  transfers: number;
  totalTransfers: number;
  speed: number;
  eta: number | null;
}

interface JobRecord {
  id: number;
  type: JobType;
  src: string;
  dst: string;
  group: string;
}

function joinPath(parent: string, name: string): string {
  if (!name) return parent; // copying a whole directory's contents
  return parent ? `${parent}/${name}` : name;
}

export class JobService {
  private readonly records = new Map<number, JobRecord>();

  constructor(private readonly client: RcClient) {}

  async launch(input: LaunchInput): Promise<{ jobid: number }> {
    const { type, src, dst, isDir } = input;
    const group = `gui-${randomUUID()}`;
    const srcLabel = `${src.remote}:${joinPath(src.path, src.name)}`;
    const dstLabel = `${dst.remote}:${joinPath(dst.path, dst.name)}`;

    let jobid: number;
    if (isDir) {
      const rcPath = type === "move" ? "sync/move" : "sync/copy";
      const out = await this.client.call<{ jobid: number }>(rcPath, {
        srcFs: fsString(src.remote, joinPath(src.path, src.name)),
        dstFs: fsString(dst.remote, joinPath(dst.path, dst.name)),
        _async: true,
        _group: group,
      });
      jobid = out.jobid;
    } else {
      const rcPath = type === "move" ? "operations/movefile" : "operations/copyfile";
      const out = await this.client.call<{ jobid: number }>(rcPath, {
        srcFs: fsString(src.remote, src.path),
        srcRemote: src.name,
        dstFs: fsString(dst.remote, dst.path),
        dstRemote: dst.name,
        _async: true,
        _group: group,
      });
      jobid = out.jobid;
    }

    this.records.set(jobid, { id: jobid, type, src: srcLabel, dst: dstLabel, group });
    return { jobid };
  }

  async list(): Promise<JobInfo[]> {
    const infos: JobInfo[] = [];
    for (const rec of this.records.values()) {
      const status = await this.client
        .call<{ finished?: boolean; success?: boolean; error?: string }>("job/status", { jobid: rec.id })
        .catch(() => ({} as { finished?: boolean; success?: boolean; error?: string }));
      const stats = await this.client
        .call<{ bytes?: number; totalBytes?: number; transfers?: number; totalTransfers?: number; speed?: number; eta?: number | null }>(
          "core/stats",
          { group: rec.group },
        )
        .catch(() => ({}));
      infos.push({
        id: rec.id,
        type: rec.type,
        src: rec.src,
        dst: rec.dst,
        finished: Boolean(status.finished),
        success: Boolean(status.success),
        error: status.error ?? "",
        bytes: stats.bytes ?? 0,
        totalBytes: stats.totalBytes ?? 0,
        transfers: stats.transfers ?? 0,
        totalTransfers: stats.totalTransfers ?? 0,
        speed: stats.speed ?? 0,
        eta: stats.eta ?? null,
      });
    }
    return infos.sort((a, b) => b.id - a.id);
  }

  async stop(jobid: number): Promise<void> {
    await this.client.call("job/stop", { jobid });
  }
}
```

- [ ] **Step 2: Create `server/src/routes/jobs.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { JobService, LaunchInput } from "../rclone/jobs.js";

export function jobsRoutes(jobs: JobService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.post<{ Body: LaunchInput }>("/api/jobs", async (req, reply) => {
      const b = req.body;
      if (!b || !b.src?.remote || !b.dst?.remote || !b.src?.name) {
        return reply.code(400).send({ error: "src.remote, src.name and dst.remote are required", status: 400 });
      }
      if (b.type !== "copy" && b.type !== "move") {
        return reply.code(400).send({ error: "type must be copy or move", status: 400 });
      }
      return jobs.launch(b);
    });

    app.get("/api/jobs", async () => ({ jobs: await jobs.list() }));

    app.post<{ Params: { id: string } }>("/api/jobs/:id/stop", async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid job id", status: 400 });
      await jobs.stop(id);
      return reply.code(200).send({ stopped: id });
    });
  };
}
```

- [ ] **Step 3: Wire into `server/src/app.ts`**

Add to `BuildAppDeps`: `jobs?: JobService;`
Add imports: `import { jobsRoutes } from "./routes/jobs.js";` and `import type { JobService } from "./rclone/jobs.js";`
Register with the api routes (before static): `if (deps.jobs) await app.register(jobsRoutes(deps.jobs));`

- [ ] **Step 4: Construct in `server/src/index.ts`**

Add import `import { JobService } from "./rclone/jobs.js";`, create `const jobs = new JobService(client);`, pass `jobs,` in `buildApp({...})`.

- [ ] **Step 5: Write the failing test `server/test/jobs.test.ts`**

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { JobService } from "../src/rclone/jobs.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
let srcDir: string;
let dstDir: string;
const R = "loc";

beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  const client = new RcClient(daemon);
  await new RemoteService(client).create(R, "local", {});
  app = await buildApp({ jobs: new JobService(client) });
  srcDir = await mkdtemp(path.join(os.tmpdir(), "rg-jobsrc-"));
  dstDir = await mkdtemp(path.join(os.tmpdir(), "rg-jobdst-"));
  await writeFile(path.join(srcDir, "f1.txt"), "one", "utf8");
  await writeFile(path.join(srcDir, "f2.txt"), "two", "utf8");
});
afterAll(async () => { await app.close(); await daemon.stop(); });

async function waitForFinished(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const { jobs } = (await app.inject({ method: "GET", url: "/api/jobs" })).json() as { jobs: Array<{ finished: boolean }> };
    if (jobs.length > 0 && jobs.every((j) => j.finished)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("job did not finish in time");
}

test("launch a directory copy job, see it in the list, and it finishes", async () => {
  // copy the whole srcDir contents into dstDir: treat srcDir as the item.
  const launch = await app.inject({
    method: "POST", url: "/api/jobs",
    payload: {
      type: "copy",
      isDir: true,
      src: { remote: R, path: srcDir, name: "" },
      dst: { remote: R, path: dstDir, name: "" },
    },
  });
  expect(launch.statusCode).toBe(200);
  const { jobid } = launch.json() as { jobid: number };
  expect(typeof jobid).toBe("number");

  await waitForFinished();

  const { jobs } = (await app.inject({ method: "GET", url: "/api/jobs" })).json() as {
    jobs: Array<{ id: number; type: string; finished: boolean; success: boolean }>;
  };
  const job = jobs.find((j) => j.id === jobid)!;
  expect(job).toMatchObject({ type: "copy", finished: true, success: true });
});

test("validation: bad type is 400", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/jobs",
    payload: { type: "nope", isDir: true, src: { remote: R, path: srcDir, name: "x" }, dst: { remote: R, path: dstDir, name: "x" } },
  });
  expect(res.statusCode).toBe(400);
});

test("validation: missing src is 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/jobs", payload: { type: "copy", isDir: true, dst: { remote: R, path: dstDir, name: "x" } } });
  expect(res.statusCode).toBe(400);
});
```

Note on the copy test: with `name: ""` (copying a whole directory's contents), `joinPath(srcDir, "")` returns `srcDir` (the helper short-circuits empty names), so `srcFs` is `loc:<srcDir>` — exactly the directory-copy form verified during design.

- [ ] **Step 6: Run** `npm --workspace server run test jobs` → expect 3 passing tests. If the copy test fails due to the empty-name trailing slash, apply the `joinPath` tweak noted above. Then full suite green.

- [ ] **Step 7: Commit**

```bash
git add server/src/rclone/jobs.ts server/src/routes/jobs.ts server/src/app.ts server/src/index.ts server/test/jobs.test.ts
git commit -m "feat(server): job service + launch/list/stop copy & move endpoints"
```

---

## Self-review notes (author check against the spec)

- **Browse one directory level** → `BrowseService.list` + `GET /api/browse` (Task 1).
- **mkdir / delete (file vs recursive dir)** → `deletePath` chooses `deletefile`/`purge` (Task 1).
- **Copy/move to a destination, async, with progress** → `JobService.launch` (dir → `sync/copy`/`sync/move`; file → `operations/copyfile`/`movefile`, all `_async` + `_group`), `list()` merges `job/status` + `core/stats` (Task 2).
- **Stop a job** → `POST /api/jobs/:id/stop` (Task 2).
- **Process-lifetime in-memory registry** → `JobService.records` map (Task 2).
- All exercised against a real `rcd` with the `local` backend; no cloud creds.

## Execution handoff

After this lands, Plan B (frontend: browse page, transfer dialog, jobs panel + polling) builds the UI on these endpoints.
