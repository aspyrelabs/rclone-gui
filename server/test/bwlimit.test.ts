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
