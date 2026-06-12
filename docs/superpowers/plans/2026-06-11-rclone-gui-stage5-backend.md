# rclone GUI — Stage 5 Plan A: Backend (Bandwidth Limit & Run History)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a global bandwidth-limit service+endpoints (`core/bwlimit`) and extend the schedule store with a capped per-schedule run history.

**Reference spec:** `docs/superpowers/specs/2026-06-11-rclone-gui-stage-5-design.md`
**Builds on:** Stages 1–4 (merged). Existing: `RcClient.call<T>`, `buildApp(deps)`, `startTestDaemon()`, `ScheduleStore` (`server/src/schedules/store.ts`) with `recordRun`.

## Verified rc shape
- `core/bwlimit` → `{ rate, bytesPerSecond, bytesPerSecondRx, bytesPerSecondTx }`; `{}` reads, `{rate}` sets (`"1M"`→`"1Mi"`, `"off"`→`-1`).

---

## Task 1: BwLimitService + routes

**Files:** Create `server/src/rclone/bwlimit.ts`, `server/src/routes/bwlimit.ts`; modify `server/src/app.ts`, `server/src/index.ts`; create `server/test/bwlimit.test.ts`.

- [ ] **Step 1: `server/src/rclone/bwlimit.ts`**

```ts
import type { RcClient } from "./client.js";

export interface BwLimit {
  rate: string;
  bytesPerSecond: number;
  bytesPerSecondRx: number;
  bytesPerSecondTx: number;
}

export class BwLimitService {
  constructor(private readonly client: RcClient) {}

  get(): Promise<BwLimit> {
    return this.client.call<BwLimit>("core/bwlimit");
  }

  set(rate: string): Promise<BwLimit> {
    return this.client.call<BwLimit>("core/bwlimit", { rate });
  }
}
```

- [ ] **Step 2: `server/src/routes/bwlimit.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { BwLimitService } from "../rclone/bwlimit.js";

export function bwlimitRoutes(bwlimit: BwLimitService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/bwlimit", async () => bwlimit.get());
    app.post<{ Body: { rate?: string } }>("/api/bwlimit", async (req, reply) => {
      const rate = req.body?.rate;
      if (!rate) return reply.code(400).send({ error: "rate is required", status: 400 });
      return bwlimit.set(rate);
    });
  };
}
```

- [ ] **Step 3: Wire into `server/src/app.ts`**

Add to `BuildAppDeps`: `bwlimit?: BwLimitService;`
Add imports: `import { bwlimitRoutes } from "./routes/bwlimit.js";` and `import type { BwLimitService } from "./rclone/bwlimit.js";`
Register before static: `if (deps.bwlimit) await app.register(bwlimitRoutes(deps.bwlimit));`

- [ ] **Step 4: Construct in `server/src/index.ts`**

Add `import { BwLimitService } from "./rclone/bwlimit.js";`, `const bwlimit = new BwLimitService(client);`, pass `bwlimit,` to `buildApp({...})`.

- [ ] **Step 5: `server/test/bwlimit.test.ts`**

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { BwLimitService } from "../src/rclone/bwlimit.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  app = await buildApp({ bwlimit: new BwLimitService(new RcClient(daemon)) });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("GET /api/bwlimit returns the current (off) limit", async () => {
  const res = await app.inject({ method: "GET", url: "/api/bwlimit" });
  expect(res.statusCode).toBe(200);
  expect((res.json() as { rate: string }).rate).toBe("off");
});

test("POST sets the limit and GET reflects it; then turn off", async () => {
  const set = await app.inject({ method: "POST", url: "/api/bwlimit", payload: { rate: "1M" } });
  expect(set.statusCode).toBe(200);
  expect((set.json() as { bytesPerSecond: number }).bytesPerSecond).toBe(1048576);

  const get = await app.inject({ method: "GET", url: "/api/bwlimit" });
  expect((get.json() as { bytesPerSecond: number }).bytesPerSecond).toBe(1048576);

  const off = await app.inject({ method: "POST", url: "/api/bwlimit", payload: { rate: "off" } });
  expect((off.json() as { bytesPerSecond: number }).bytesPerSecond).toBe(-1);
});

test("missing rate is a 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/bwlimit", payload: {} });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 6: Run** `npm --workspace server run test bwlimit` → 3 passing. Full suite green. `tsc --noEmit` clean. No leftover rcd.

- [ ] **Step 7: Commit**

```bash
git add server/src/rclone/bwlimit.ts server/src/routes/bwlimit.ts server/src/app.ts server/src/index.ts server/test/bwlimit.test.ts
git commit -m "feat(server): global bandwidth-limit service + endpoints"
```

---

## Task 2: Schedule run history

**Files:** Modify `server/src/schedules/store.ts`; create `server/test/schedule-history.test.ts`.

- [ ] **Step 1: Edit `server/src/schedules/store.ts`**

Add a `RunRecord` interface and a `history` field on `Schedule`, exclude `history` from `ScheduleInput`, default it on create/load, and append (capped at 20, newest first) in `recordRun`.

- Add the interface (near `Schedule`):
```ts
export interface RunRecord {
  time: string;
  jobId?: number;
  error?: string;
}
```
- Add to the `Schedule` interface: `history: RunRecord[];`
- Change `ScheduleInput` to also omit `history`:
```ts
export type ScheduleInput = Omit<Schedule, "id" | "lastRun" | "lastJobId" | "lastError" | "history">;
```
- In `create()`, initialize history:
```ts
    const s: Schedule = { ...input, id: randomUUID(), history: [] };
```
- In `load()`, normalize so older files (no `history`) get an array. After computing `parsed`:
```ts
      const arr = Array.isArray(parsed) ? (parsed as Schedule[]) : [];
      this.schedules = arr.map((s) => ({ ...s, history: s.history ?? [] }));
```
  (Replace the existing assignment to `this.schedules` accordingly; keep the ENOENT handling.)
- In `recordRun()`, append a capped record (newest first):
```ts
  async recordRun(id: string, fields: { lastJobId?: number; lastError?: string }): Promise<void> {
    const s = this.schedules.find((x) => x.id === id);
    if (!s) return;
    s.lastRun = this.now();
    if (fields.lastJobId !== undefined) s.lastJobId = fields.lastJobId;
    s.lastError = fields.lastError;
    const record: RunRecord = { time: s.lastRun, jobId: fields.lastJobId, error: fields.lastError };
    s.history = [record, ...(s.history ?? [])].slice(0, 20);
    await this.save();
  }
```

- [ ] **Step 2: Create `server/test/schedule-history.test.ts`**

```ts
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScheduleStore } from "../src/schedules/store.js";

let dir: string;
let filePath: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "rg-hist-")); filePath = path.join(dir, "schedules.json"); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const base = {
  name: "h", type: "copy" as const, isDir: true,
  src: { remote: "a", path: "", name: "" }, dst: { remote: "b", path: "", name: "" },
  cron: "0 3 * * *", enabled: true,
};

test("new schedule starts with empty history", async () => {
  const store = new ScheduleStore({ filePath });
  await store.load();
  const s = await store.create(base);
  expect(store.get(s.id)?.history).toEqual([]);
});

test("recordRun prepends records (newest first), mixing success and error", async () => {
  let t = 0;
  const store = new ScheduleStore({ filePath, now: () => `T${t}` });
  await store.load();
  const s = await store.create(base);

  t = 1; await store.recordRun(s.id, { lastJobId: 11 });
  t = 2; await store.recordRun(s.id, { lastError: "boom" });

  const h = store.get(s.id)!.history;
  expect(h).toEqual([
    { time: "T2", jobId: undefined, error: "boom" },
    { time: "T1", jobId: 11, error: undefined },
  ]);
});

test("history is capped at 20 (newest kept)", async () => {
  let t = 0;
  const store = new ScheduleStore({ filePath, now: () => `T${t}` });
  await store.load();
  const s = await store.create(base);
  for (let i = 1; i <= 25; i++) { t = i; await store.recordRun(s.id, { lastJobId: i }); }
  const h = store.get(s.id)!.history;
  expect(h).toHaveLength(20);
  expect(h[0]).toMatchObject({ jobId: 25 }); // newest first
  expect(h[19]).toMatchObject({ jobId: 6 }); // oldest kept
});

test("older file without history loads with an empty history array", async () => {
  // write a schedule file with no `history` field
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filePath, JSON.stringify([{ ...base, id: "x" }]), "utf8");
  const store = new ScheduleStore({ filePath });
  await store.load();
  expect(store.get("x")?.history).toEqual([]);
});
```

- [ ] **Step 3: Run** `npm --workspace server run test schedule-history` → 4 passing. Then `npm --workspace server run test scheduler schedule-store schedules-routes` to confirm the existing schedule suites still pass with the type changes. Full suite green. `tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/schedules/store.ts server/test/schedule-history.test.ts
git commit -m "feat(server): capped per-schedule run history"
```

---

## Self-review notes
- **bwlimit get/set** → `BwLimitService` + routes (Task 1), live-tested.
- **Run history, capped 20, newest first, backward-compatible load** → `store.ts` (Task 2).
- Existing schedule suites remain green (history is additive; `ScheduleInput` now omits `history`, which doesn't affect callers that never passed it).

## Execution handoff
Plan B (frontend: bwlimit in Settings + history UI on Schedules) builds on these.
