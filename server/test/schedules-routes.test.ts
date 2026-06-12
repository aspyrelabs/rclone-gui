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
