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

  const listed = (await app.inject({ method: "GET", url: "/api/serve" })).json() as { serves: Array<{ id: string; type: string }> };
  expect(listed.serves.find((s) => s.id === id)).toMatchObject({ type: "http" });

  const resp = await fetch(`http://${addr}/hello.txt`);
  expect(await resp.text()).toContain("served-content");

  const stop = await app.inject({ method: "POST", url: `/api/serve/${id}/stop` });
  expect(stop.statusCode).toBe(200);
  const after = (await app.inject({ method: "GET", url: "/api/serve" })).json() as { serves: Array<{ id: string }> };
  expect(after.serves.find((s) => s.id === id)).toBeUndefined();
});

test("missing type is a 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/serve", payload: { remote: "loc" } });
  expect(res.statusCode).toBe(400);
});
