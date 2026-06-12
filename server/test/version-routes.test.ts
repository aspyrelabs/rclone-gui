import { afterEach, expect, test, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { VersionService } from "../src/rclone/version.js";

let app: FastifyInstance;
afterEach(async () => { if (app) await app.close(); });

test("GET /api/version returns the status", async () => {
  const version = new VersionService({
    getInstalled: async () => "v1.74.3",
    fetchLatest: async () => "v1.75.0",
    install: async () => {},
    afterInstall: async () => {},
  });
  app = await buildApp({ version });
  const res = await app.inject({ method: "GET", url: "/api/version" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ installed: "v1.74.3", latest: "v1.75.0", updateAvailable: true });
});

test("POST /api/version/update triggers install + afterInstall", async () => {
  const install = vi.fn(async () => {});
  const afterInstall = vi.fn(async () => {});
  const version = new VersionService({
    getInstalled: async () => "v1.75.0",
    fetchLatest: async () => "v1.75.0",
    install,
    afterInstall,
  });
  app = await buildApp({ version });
  const res = await app.inject({ method: "POST", url: "/api/version/update", payload: {} });
  expect(res.statusCode).toBe(200);
  expect(install).toHaveBeenCalledWith("v1.75.0");
  expect(afterInstall).toHaveBeenCalled();
});
