# rclone GUI — Stage 4 Plan A: Backend (Scheduling)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist copy/move schedules and run them on a cron schedule via a background scheduler, reusing the Stage 2 `JobService`. CRUD + run-now over REST.

**Architecture:** `ScheduleStore` persists schedules to `<configDir>/schedules.json` (atomic writes). `Scheduler` registers a cron task per enabled schedule through an **injectable `Cron` interface** (default backed by `node-cron`) and, on fire, calls `JobService.launch(...)` and records the result. `ScheduleService` wraps CRUD + run-now and re-syncs the scheduler. Injectable `now()` + `Cron` keep tests deterministic (no real-time waits).

**Tech Stack:** adds `node-cron` (+ `@types/node-cron`). Vitest; fake `Cron` + temp file in tests; real `JobService`+`rcd` for the fire→launch path.

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-4-design.md`
**Builds on:** Stages 1–3 (merged). Existing: `JobService.launch(LaunchInput)` where `LaunchInput = {type:"copy"|"move", isDir, src:PathRef, dst:PathRef}` and `PathRef = {remote,path,name}`; `buildApp(deps)`; `startTestDaemon()`; `RemoteService.create`; `loadConfig()`/`AppConfig` with `configDir`.

---

## File structure introduced

```
server/src/
  schedules/store.ts       # ScheduleStore (persistence) + Schedule type
  schedules/cron.ts        # Cron interface + nodeCron implementation
  schedules/scheduler.ts   # Scheduler (register tasks, fire)
  schedules/service.ts     # ScheduleService (CRUD + runNow + validate)
  config.ts                # + schedulesPath
  routes/schedules.ts      # /api/schedules CRUD + :id/run
  app.ts                   # wire schedules routes
  index.ts                 # construct store/scheduler/service, load + reload
server/test/
  schedule-store.test.ts
  scheduler.test.ts
  schedules-routes.test.ts
```

---

## Task 1: ScheduleStore + types

**Files:** Create `server/src/schedules/store.ts`; create `server/test/schedule-store.test.ts`.

- [ ] **Step 1: `server/src/schedules/store.ts`**

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface SchedulePathRef {
  remote: string;
  path: string;
  name: string;
}

export interface Schedule {
  id: string;
  name: string;
  type: "copy" | "move";
  isDir: boolean;
  src: SchedulePathRef;
  dst: SchedulePathRef;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  lastJobId?: number;
  lastError?: string;
}

export type ScheduleInput = Omit<Schedule, "id" | "lastRun" | "lastJobId" | "lastError">;

export interface ScheduleStoreOpts {
  filePath: string;
  now?: () => string;
}

export class ScheduleStore {
  private schedules: Schedule[] = [];
  private readonly now: () => string;

  constructor(private readonly opts: ScheduleStoreOpts) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.opts.filePath, "utf8");
      this.schedules = text.trim() ? (JSON.parse(text) as Schedule[]) : [];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.schedules = [];
      } else {
        throw e;
      }
    }
  }

  list(): Schedule[] {
    return this.schedules.map((s) => ({ ...s }));
  }

  get(id: string): Schedule | undefined {
    const s = this.schedules.find((x) => x.id === id);
    return s ? { ...s } : undefined;
  }

  async create(input: ScheduleInput): Promise<Schedule> {
    const s: Schedule = { ...input, id: randomUUID() };
    this.schedules.push(s);
    await this.save();
    return { ...s };
  }

  async update(id: string, patch: Partial<ScheduleInput>): Promise<Schedule | undefined> {
    const s = this.schedules.find((x) => x.id === id);
    if (!s) return undefined;
    Object.assign(s, patch);
    await this.save();
    return { ...s };
  }

  async delete(id: string): Promise<boolean> {
    const before = this.schedules.length;
    this.schedules = this.schedules.filter((x) => x.id !== id);
    if (this.schedules.length === before) return false;
    await this.save();
    return true;
  }

  async recordRun(id: string, fields: { lastJobId?: number; lastError?: string }): Promise<void> {
    const s = this.schedules.find((x) => x.id === id);
    if (!s) return;
    s.lastRun = this.now();
    s.lastJobId = fields.lastJobId;
    s.lastError = fields.lastError;
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.opts.filePath), { recursive: true });
    const tmp = `${this.opts.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.schedules, null, 2), "utf8");
    await rename(tmp, this.opts.filePath);
  }
}
```

- [ ] **Step 2: `server/test/schedule-store.test.ts`**

```ts
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScheduleStore } from "../src/schedules/store.js";

let dir: string;
let filePath: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "rg-sched-")); filePath = path.join(dir, "schedules.json"); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const base = {
  name: "nightly", type: "copy" as const, isDir: true,
  src: { remote: "a", path: "", name: "" }, dst: { remote: "b", path: "", name: "" },
  cron: "0 3 * * *", enabled: true,
};

test("missing file loads as empty", async () => {
  const store = new ScheduleStore({ filePath });
  await store.load();
  expect(store.list()).toEqual([]);
});

test("create persists and reloads", async () => {
  const store = new ScheduleStore({ filePath });
  await store.load();
  const created = await store.create(base);
  expect(created.id).toBeTruthy();

  const reloaded = new ScheduleStore({ filePath });
  await reloaded.load();
  expect(reloaded.list()).toHaveLength(1);
  expect(reloaded.get(created.id)?.name).toBe("nightly");
});

test("update, recordRun, and delete", async () => {
  const store = new ScheduleStore({ filePath, now: () => "2026-01-01T00:00:00.000Z" });
  await store.load();
  const s = await store.create(base);

  await store.update(s.id, { enabled: false });
  expect(store.get(s.id)?.enabled).toBe(false);

  await store.recordRun(s.id, { lastJobId: 9 });
  expect(store.get(s.id)).toMatchObject({ lastRun: "2026-01-01T00:00:00.000Z", lastJobId: 9 });

  expect(await store.delete(s.id)).toBe(true);
  expect(store.list()).toEqual([]);
  expect(await store.delete(s.id)).toBe(false);
});

test("list/get return copies (no external mutation)", async () => {
  const store = new ScheduleStore({ filePath });
  await store.load();
  const s = await store.create(base);
  const got = store.get(s.id)!;
  got.name = "mutated";
  expect(store.get(s.id)?.name).toBe("nightly");
});
```

- [ ] **Step 3: Run** `npm --workspace server run test schedule-store` → 4 passing. Full suite green. `tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/schedules/store.ts server/test/schedule-store.test.ts
git commit -m "feat(server): schedule store (persist schedules.json)"
```

---

## Task 2: Cron + Scheduler + ScheduleService

**Files:** Create `server/src/schedules/cron.ts`, `server/src/schedules/scheduler.ts`, `server/src/schedules/service.ts`; modify `server/package.json` (add `node-cron`); create `server/test/scheduler.test.ts`.

- [ ] **Step 1: Add the dependency**

In `server/package.json` add to `dependencies`: `"node-cron": "^3.0.3"` and to `devDependencies`: `"@types/node-cron": "^3.0.11"`. Then from repo root run `npm install`.

- [ ] **Step 2: `server/src/schedules/cron.ts`**

```ts
import cron from "node-cron";

export interface CronTask {
  stop(): void;
}

export interface Cron {
  validate(expr: string): boolean;
  schedule(expr: string, fn: () => void): CronTask;
}

export const nodeCron: Cron = {
  validate: (expr) => cron.validate(expr),
  schedule: (expr, fn) => {
    const task = cron.schedule(expr, fn);
    return { stop: () => task.stop() };
  },
};
```

- [ ] **Step 3: `server/src/schedules/scheduler.ts`**

```ts
import type { JobService } from "../rclone/jobs.js";
import type { Cron, CronTask } from "./cron.js";
import type { ScheduleStore } from "./store.js";

export class Scheduler {
  private tasks = new Map<string, CronTask>();

  constructor(
    private readonly store: ScheduleStore,
    private readonly jobs: JobService,
    private readonly cron: Cron,
  ) {}

  /** Re-register cron tasks to match the current enabled schedules. */
  reload(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
    for (const s of this.store.list()) {
      if (s.enabled && this.cron.validate(s.cron)) {
        this.tasks.set(s.id, this.cron.schedule(s.cron, () => { void this.fire(s.id); }));
      }
    }
  }

  /** Launch the schedule's job now and record the outcome. */
  async fire(id: string): Promise<void> {
    const s = this.store.get(id);
    if (!s) return;
    try {
      const { jobid } = await this.jobs.launch({ type: s.type, isDir: s.isDir, src: s.src, dst: s.dst });
      await this.store.recordRun(id, { lastJobId: jobid, lastError: undefined });
    } catch (e) {
      await this.store.recordRun(id, { lastError: (e as Error).message });
    }
  }
}
```

- [ ] **Step 4: `server/src/schedules/service.ts`**

```ts
import type { Cron } from "./cron.js";
import type { Scheduler } from "./scheduler.js";
import type { Schedule, ScheduleInput, ScheduleStore } from "./store.js";

export class ScheduleService {
  constructor(
    private readonly store: ScheduleStore,
    private readonly scheduler: Scheduler,
    private readonly cron: Cron,
  ) {}

  isValidCron(expr: string): boolean {
    return this.cron.validate(expr);
  }

  list(): Schedule[] {
    return this.store.list();
  }

  async create(input: ScheduleInput): Promise<Schedule> {
    if (!this.cron.validate(input.cron)) throw new Error("invalid cron expression");
    const s = await this.store.create(input);
    this.scheduler.reload();
    return s;
  }

  async update(id: string, patch: Partial<ScheduleInput>): Promise<Schedule | undefined> {
    if (patch.cron !== undefined && !this.cron.validate(patch.cron)) throw new Error("invalid cron expression");
    const s = await this.store.update(id, patch);
    this.scheduler.reload();
    return s;
  }

  async delete(id: string): Promise<boolean> {
    const ok = await this.store.delete(id);
    this.scheduler.reload();
    return ok;
  }

  async runNow(id: string): Promise<void> {
    await this.scheduler.fire(id);
  }
}
```

- [ ] **Step 5: `server/test/scheduler.test.ts`** (fake cron for determinism; real `JobService`+`rcd` for the fire path)

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScheduleStore } from "../src/schedules/store.js";
import { Scheduler } from "../src/schedules/scheduler.js";
import { ScheduleService } from "../src/schedules/service.js";
import type { Cron, CronTask } from "../src/schedules/cron.js";
import { RcClient } from "../src/rclone/client.js";
import { JobService } from "../src/rclone/jobs.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

class FakeCron implements Cron {
  tasks: Array<{ expr: string; fn: () => void }> = [];
  validate(expr: string): boolean { return expr !== "BAD"; }
  schedule(expr: string, fn: () => void): CronTask {
    const t = { expr, fn };
    this.tasks.push(t);
    return { stop: () => { this.tasks = this.tasks.filter((x) => x !== t); } };
  }
}

let daemon: RcloneDaemon;
let jobs: JobService;
let srcDir: string;
let dstDir: string;

beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  const client = new RcClient(daemon);
  await new RemoteService(client).create("loc", "local", {});
  jobs = new JobService(client);
  srcDir = await mkdtemp(path.join(os.tmpdir(), "rg-s4src-"));
  dstDir = await mkdtemp(path.join(os.tmpdir(), "rg-s4dst-"));
  await writeFile(path.join(srcDir, "f.txt"), "data", "utf8");
});
afterAll(async () => { await daemon.stop(); });

function newStack() {
  const store = new ScheduleStore({ filePath: path.join(srcDir, `sched-${Math.random()}.json`), now: () => "T" });
  const cron = new FakeCron();
  const scheduler = new Scheduler(store, jobs, cron);
  const service = new ScheduleService(store, scheduler, cron);
  return { store, cron, scheduler, service };
}

test("create registers an enabled task; disabled schedules are not registered", async () => {
  const { store, cron, service } = newStack();
  await store.load();
  await service.create({ name: "on", type: "copy", isDir: true, src: { remote: "loc", path: srcDir, name: "" }, dst: { remote: "loc", path: dstDir, name: "" }, cron: "* * * * *", enabled: true });
  await service.create({ name: "off", type: "copy", isDir: true, src: { remote: "loc", path: srcDir, name: "" }, dst: { remote: "loc", path: dstDir, name: "" }, cron: "* * * * *", enabled: false });
  expect(cron.tasks).toHaveLength(1);
});

test("invalid cron is rejected", async () => {
  const { store, service } = newStack();
  await store.load();
  await expect(service.create({ name: "bad", type: "copy", isDir: true, src: { remote: "loc", path: srcDir, name: "" }, dst: { remote: "loc", path: dstDir, name: "" }, cron: "BAD", enabled: true })).rejects.toThrow(/invalid cron/);
});

test("firing a task launches a real job and records lastJobId", async () => {
  const { store, cron, service } = newStack();
  await store.load();
  const s = await service.create({ name: "fire", type: "copy", isDir: true, src: { remote: "loc", path: srcDir, name: "" }, dst: { remote: "loc", path: dstDir, name: "" }, cron: "* * * * *", enabled: true });
  // simulate cron firing
  cron.tasks[0].fn();
  // fire() is async; wait briefly for the launch + recordRun
  await new Promise((r) => setTimeout(r, 300));
  const updated = store.get(s.id)!;
  expect(typeof updated.lastJobId).toBe("number");
  expect(updated.lastError).toBeUndefined();
  expect(updated.lastRun).toBe("T");
});

test("runNow fires immediately", async () => {
  const { store, service } = newStack();
  await store.load();
  const s = await service.create({ name: "now", type: "copy", isDir: true, src: { remote: "loc", path: srcDir, name: "" }, dst: { remote: "loc", path: dstDir, name: "" }, cron: "* * * * *", enabled: true });
  await service.runNow(s.id);
  expect(typeof store.get(s.id)!.lastJobId).toBe("number");
});
```

- [ ] **Step 6: Run** `npm --workspace server run test scheduler` → 4 passing. Full suite green. `tsc --noEmit` clean. No leftover rcd.

- [ ] **Step 7: Commit**

```bash
git add server/package.json package-lock.json server/src/schedules/cron.ts server/src/schedules/scheduler.ts server/src/schedules/service.ts server/test/scheduler.test.ts
git commit -m "feat(server): cron-backed scheduler + schedule service (node-cron, injectable)"
```

---

## Task 3: Routes + bootstrap wiring

**Files:** Modify `server/src/config.ts`, `server/src/app.ts`, `server/src/index.ts`; create `server/src/routes/schedules.ts`; create `server/test/schedules-routes.test.ts`.

- [ ] **Step 1: `server/src/config.ts`**

Add to `AppConfig`: `schedulesPath: string;`
Add to `loadConfig` return: `schedulesPath: env.SCHEDULES_PATH ?? path.join(configDir, "schedules.json"),`
(`path` is already imported in config.ts.)

- [ ] **Step 2: `server/src/routes/schedules.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { ScheduleService } from "../schedules/service.js";
import type { ScheduleInput } from "../schedules/store.js";

function validInput(b: Partial<ScheduleInput>): b is ScheduleInput {
  return Boolean(
    b && b.name && (b.type === "copy" || b.type === "move") &&
    typeof b.isDir === "boolean" && b.src?.remote && b.dst?.remote &&
    typeof b.cron === "string" && typeof b.enabled === "boolean",
  );
}

export function schedulesRoutes(service: ScheduleService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/schedules", async () => ({ schedules: service.list() }));

    app.post<{ Body: ScheduleInput }>("/api/schedules", async (req, reply) => {
      const b = req.body;
      if (!validInput(b)) return reply.code(400).send({ error: "invalid schedule", status: 400 });
      if (!service.isValidCron(b.cron)) return reply.code(400).send({ error: "invalid cron expression", status: 400 });
      return reply.code(201).send({ schedule: await service.create(b) });
    });

    app.put<{ Params: { id: string }; Body: Partial<ScheduleInput> }>("/api/schedules/:id", async (req, reply) => {
      const patch = req.body ?? {};
      if (patch.cron !== undefined && !service.isValidCron(patch.cron)) {
        return reply.code(400).send({ error: "invalid cron expression", status: 400 });
      }
      const s = await service.update(req.params.id, patch);
      if (!s) return reply.code(404).send({ error: "not found", status: 404 });
      return { schedule: s };
    });

    app.delete<{ Params: { id: string } }>("/api/schedules/:id", async (req, reply) => {
      const ok = await service.delete(req.params.id);
      if (!ok) return reply.code(404).send({ error: "not found", status: 404 });
      return { deleted: req.params.id };
    });

    app.post<{ Params: { id: string } }>("/api/schedules/:id/run", async (req, reply) => {
      await service.runNow(req.params.id);
      return reply.code(200).send({ ran: req.params.id });
    });
  };
}
```

- [ ] **Step 3: Wire into `server/src/app.ts`**

Add to `BuildAppDeps`: `schedules?: ScheduleService;`
Add imports: `import { schedulesRoutes } from "./routes/schedules.js";` and `import type { ScheduleService } from "./schedules/service.js";`
Register before static: `if (deps.schedules) await app.register(schedulesRoutes(deps.schedules));`

- [ ] **Step 4: Wire into `server/src/index.ts`**

Add imports:
```ts
import { ScheduleStore } from "./schedules/store.js";
import { Scheduler } from "./schedules/scheduler.js";
import { ScheduleService } from "./schedules/service.js";
import { nodeCron } from "./schedules/cron.js";
```
After `jobs` (the `JobService`) is created, add:
```ts
  const scheduleStore = new ScheduleStore({ filePath: cfg.schedulesPath });
  await scheduleStore.load();
  const scheduler = new Scheduler(scheduleStore, jobs, nodeCron);
  const schedules = new ScheduleService(scheduleStore, scheduler, nodeCron);
  scheduler.reload(); // register tasks for enabled schedules loaded from disk
```
Add `schedules,` to the `buildApp({...})` call.

- [ ] **Step 5: `server/test/schedules-routes.test.ts`**

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { ScheduleStore } from "../src/schedules/store.js";
import { Scheduler } from "../src/schedules/scheduler.js";
import { ScheduleService } from "../src/schedules/service.js";
import type { Cron, CronTask } from "../src/schedules/cron.js";
import { RcClient } from "../src/rclone/client.js";
import { JobService } from "../src/rclone/jobs.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

class FakeCron implements Cron {
  tasks: Array<{ expr: string; fn: () => void }> = [];
  validate(expr: string): boolean { return expr !== "BAD"; }
  schedule(expr: string, fn: () => void): CronTask {
    const t = { expr, fn }; this.tasks.push(t);
    return { stop: () => { this.tasks = this.tasks.filter((x) => x !== t); } };
  }
}

let daemon: RcloneDaemon;
let app: FastifyInstance;

beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  const dir = await mkdtemp(path.join(os.tmpdir(), "rg-s4r-"));
  const store = new ScheduleStore({ filePath: path.join(dir, "schedules.json") });
  await store.load();
  const cron = new FakeCron();
  const jobs = new JobService(new RcClient(daemon));
  const scheduler = new Scheduler(store, jobs, cron);
  app = await buildApp({ schedules: new ScheduleService(store, scheduler, cron) });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

const body = {
  name: "n", type: "copy", isDir: true,
  src: { remote: "loc", path: "", name: "" }, dst: { remote: "loc", path: "", name: "" },
  cron: "0 3 * * *", enabled: true,
};

test("CRUD a schedule via the API", async () => {
  const created = await app.inject({ method: "POST", url: "/api/schedules", payload: body });
  expect(created.statusCode).toBe(201);
  const id = (created.json() as { schedule: { id: string } }).schedule.id;

  const listed = await app.inject({ method: "GET", url: "/api/schedules" });
  expect((listed.json() as { schedules: unknown[] }).schedules).toHaveLength(1);

  const updated = await app.inject({ method: "PUT", url: `/api/schedules/${id}`, payload: { enabled: false } });
  expect(updated.statusCode).toBe(200);
  expect((updated.json() as { schedule: { enabled: boolean } }).schedule.enabled).toBe(false);

  const del = await app.inject({ method: "DELETE", url: `/api/schedules/${id}` });
  expect(del.statusCode).toBe(200);
  const after = await app.inject({ method: "GET", url: "/api/schedules" });
  expect((after.json() as { schedules: unknown[] }).schedules).toHaveLength(0);
});

test("invalid cron is a 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/schedules", payload: { ...body, cron: "BAD" } });
  expect(res.statusCode).toBe(400);
});

test("invalid body is a 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/schedules", payload: { name: "x" } });
  expect(res.statusCode).toBe(400);
});

test("PUT/DELETE unknown id is a 404", async () => {
  expect((await app.inject({ method: "PUT", url: "/api/schedules/nope", payload: { enabled: true } })).statusCode).toBe(404);
  expect((await app.inject({ method: "DELETE", url: "/api/schedules/nope" })).statusCode).toBe(404);
});
```

- [ ] **Step 6: Run** `npm --workspace server run test schedules-routes` → 4 passing. Full suite green. `tsc --noEmit` clean. No leftover rcd.

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/routes/schedules.ts server/src/app.ts server/src/index.ts server/test/schedules-routes.test.ts
git commit -m "feat(server): schedule CRUD + run-now endpoints, bootstrap scheduler"
```

---

## Self-review notes (against the spec)
- **Persist to `<configDir>/schedules.json`, atomic** → `ScheduleStore` (Task 1).
- **Cron scheduler, injectable, node-cron default** → `cron.ts` + `Scheduler` (Task 2).
- **CRUD + run-now, validate cron, last-run tracking** → `ScheduleService` + routes (Tasks 2–3); `recordRun` sets `lastRun/lastJobId/lastError`.
- **Fire reuses `JobService.launch`** → `Scheduler.fire` (Task 2), tested with a real job.
- **Startup registers enabled schedules** → `index.ts` `scheduler.reload()` after load (Task 3).
- Deterministic tests via fake `Cron` + injected `now()`.

## Execution handoff
Plan B (frontend Schedules page + nav) builds on these endpoints.
