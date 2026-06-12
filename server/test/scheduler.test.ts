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
  cron.tasks[0].fn(); // simulate cron firing
  await new Promise((r) => setTimeout(r, 300)); // fire() is async (launch + recordRun)
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

test("a failing launch records lastError and does not throw", async () => {
  const failJobs = { launch: async () => { throw new Error("boom"); } } as unknown as JobService;
  const store = new ScheduleStore({ filePath: `${srcDir}/fail-${Math.random()}.json`, now: () => "T" });
  await store.load();
  const cron = new FakeCron();
  const scheduler = new Scheduler(store, failJobs, cron);
  const service = new ScheduleService(store, scheduler, cron);
  const s = await service.create({ name: "f", type: "copy", isDir: true, src: { remote: "loc", path: srcDir, name: "" }, dst: { remote: "loc", path: dstDir, name: "" }, cron: "* * * * *", enabled: true });

  await expect(scheduler.fire(s.id)).resolves.toBeUndefined(); // does not throw
  expect(store.get(s.id)!.lastError).toBe("boom");
});

test("disabling a schedule via update stops its task", async () => {
  const { store, cron, service } = newStack();
  await store.load();
  const s = await service.create({ name: "d", type: "copy", isDir: true, src: { remote: "loc", path: srcDir, name: "" }, dst: { remote: "loc", path: dstDir, name: "" }, cron: "* * * * *", enabled: true });
  expect(cron.tasks).toHaveLength(1);
  await service.update(s.id, { enabled: false });
  expect(cron.tasks).toHaveLength(0);
});
