import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  app = await buildApp({ remotes: new RemoteService(new RcClient(daemon)) });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("rejects an invalid remote name", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/remotes",
    payload: { name: "bad name!", type: "local" },
  });
  expect(res.statusCode).toBe(400);
});

test("create -> update -> test -> delete a local remote", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rg-target-"));

  const created = await app.inject({
    method: "POST", url: "/api/remotes",
    payload: { name: "crud_local", type: "local", parameters: {} },
  });
  expect(created.statusCode).toBe(201);

  const updated = await app.inject({
    method: "PUT", url: "/api/remotes/crud_local",
    payload: { parameters: { nounc: "true" } },
  });
  expect(updated.statusCode).toBe(200);

  await app.inject({
    method: "POST", url: "/api/remotes",
    payload: { name: "crud_test", type: "local", parameters: {} },
  });
  const test = await app.inject({ method: "POST", url: `/api/remotes/crud_test/test` });
  expect(test.statusCode).toBe(200);
  expect((test.json() as { ok: boolean }).ok).toBe(true);
  void dir;

  const del = await app.inject({ method: "DELETE", url: "/api/remotes/crud_local" });
  expect(del.statusCode).toBe(200);

  const list = await app.inject({ method: "GET", url: "/api/remotes" });
  const names = (list.json() as { remotes: Array<{ name: string }> }).remotes.map((r) => r.name);
  expect(names).not.toContain("crud_local");
});
