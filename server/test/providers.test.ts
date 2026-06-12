import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { ProvidersService } from "../src/rclone/providers.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  const providers = new ProvidersService(new RcClient(daemon));
  app = await buildApp({ providers });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("GET /api/providers includes local with option metadata", async () => {
  const res = await app.inject({ method: "GET", url: "/api/providers" });
  expect(res.statusCode).toBe(200);
  const { providers } = res.json() as { providers: Array<{ Name: string; Options: unknown[] }> };
  const local = providers.find((p) => p.Name === "local");
  expect(local).toBeTruthy();
  const s3 = providers.find((p) => p.Name === "s3");
  expect(s3).toBeTruthy();
  expect(Array.isArray(s3!.Options)).toBe(true);
});
