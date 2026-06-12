import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
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

test("file-level copy works and finishes", async () => {
  const launch = await app.inject({
    method: "POST", url: "/api/jobs",
    payload: {
      type: "copy",
      isDir: false,
      src: { remote: R, path: srcDir, name: "f1.txt" },
      dst: { remote: R, path: dstDir, name: "f1_copy.txt" },
    },
  });
  expect(launch.statusCode).toBe(200);
  await waitForFinished();
  // the copied file exists at the destination
  await expect(stat(path.join(dstDir, "f1_copy.txt"))).resolves.toBeTruthy();
});

test("validation: file op with missing name is 400", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/jobs",
    payload: { type: "copy", isDir: false, src: { remote: R, path: srcDir, name: "" }, dst: { remote: R, path: dstDir, name: "x" } },
  });
  expect(res.statusCode).toBe(400);
});

test("validation: invalid job id on stop is 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/jobs/0/stop" });
  expect(res.statusCode).toBe(400);
});
