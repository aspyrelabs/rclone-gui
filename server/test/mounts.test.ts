import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { MountService } from "../src/rclone/mounts.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  app = await buildApp({ mounts: new MountService(new RcClient(daemon)) });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("GET /api/mounts/types returns the supported mount types", async () => {
  const res = await app.inject({ method: "GET", url: "/api/mounts/types" });
  expect(res.statusCode).toBe(200);
  expect(Array.isArray((res.json() as { types: string[] }).types)).toBe(true);
});

test("GET /api/mounts lists current mounts (none initially)", async () => {
  const res = await app.inject({ method: "GET", url: "/api/mounts" });
  expect(res.statusCode).toBe(200);
  expect((res.json() as { mounts: unknown[] }).mounts).toEqual([]);
});

test("MountService builds the correct rc calls", async () => {
  const calls: Array<{ path: string; params: unknown }> = [];
  const fakeClient = {
    call: vi.fn(async (path: string, params: unknown) => {
      calls.push({ path, params });
      if (path === "mount/listmounts") return { mountPoints: [{ Fs: "loc:/data", MountPoint: "/mnt/x" }] };
      return {};
    }),
  } as unknown as RcClient;
  const svc = new MountService(fakeClient);

  await svc.mount("loc", "data", "/mnt/x", "nfsmount");
  expect(calls[0]).toEqual({ path: "mount/mount", params: { fs: "loc:data", mountPoint: "/mnt/x", mountType: "nfsmount" } });

  const list = await svc.list();
  expect(list).toEqual([{ fs: "loc:/data", mountPoint: "/mnt/x" }]);

  await svc.unmount("/mnt/x");
  expect(calls[calls.length - 1]).toEqual({ path: "mount/unmount", params: { mountPoint: "/mnt/x" } });
});

test("missing mountPoint is a 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/mounts", payload: { remote: "loc" } });
  expect(res.statusCode).toBe(400);
});
