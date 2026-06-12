import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  expect(h[0]).toMatchObject({ jobId: 25 });
  expect(h[19]).toMatchObject({ jobId: 6 });
});

test("older file without history loads with an empty history array", async () => {
  await writeFile(filePath, JSON.stringify([{ ...base, id: "x" }]), "utf8");
  const store = new ScheduleStore({ filePath });
  await store.load();
  expect(store.get("x")?.history).toEqual([]);
});
