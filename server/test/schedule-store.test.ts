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
