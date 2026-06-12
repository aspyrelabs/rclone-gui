import { afterAll, beforeAll, expect, test } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { ProvidersService } from "../src/rclone/providers.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { resolveRcloneBinary } from "../src/rclone/resolveBinary.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let daemon: RcloneDaemon;
let app: FastifyInstance;
beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rg-boot-"));
  const configPath = path.join(dir, "rclone.conf");
  await writeFile(configPath, "", "utf8");
  const binary = resolveRcloneBinary({ cwd: repoRoot });
  daemon = new RcloneDaemon({ binary, configPath });
  await daemon.start();
  const client = new RcClient(daemon);
  app = await buildApp({
    providers: new ProvidersService(client),
    remotes: new RemoteService(client),
    guiPassword: null,
  });
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("full app: health + providers + empty remotes wired together", async () => {
  expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  expect((await app.inject({ method: "GET", url: "/api/providers" })).statusCode).toBe(200);
  const remotes = await app.inject({ method: "GET", url: "/api/remotes" });
  expect(remotes.statusCode).toBe(200);
  expect(remotes.json()).toEqual({ remotes: [] });
});
