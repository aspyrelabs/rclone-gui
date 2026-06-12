import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
let svc: RemoteService;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  svc = new RemoteService(new RcClient(daemon));
  app = await buildApp({ remotes: svc });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("created remote appears in GET /api/remotes with its type", async () => {
  await svc.create("unit_local", "local", {});
  const res = await app.inject({ method: "GET", url: "/api/remotes" });
  expect(res.statusCode).toBe(200);
  const { remotes } = res.json() as { remotes: Array<{ name: string; type: string }> };
  const found = remotes.find((r) => r.name === "unit_local");
  expect(found).toEqual(expect.objectContaining({ name: "unit_local", type: "local" }));
});
