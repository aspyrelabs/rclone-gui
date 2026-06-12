import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcClient } from "../src/rclone/client.js";
import { BrowseService } from "../src/rclone/browse.js";
import { RemoteService } from "../src/rclone/remotes.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let app: FastifyInstance;
let dir: string;
const REMOTE = "loc";

beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  const client = new RcClient(daemon);
  await new RemoteService(client).create(REMOTE, "local", {});
  app = await buildApp({ browse: new BrowseService(client) });

  dir = await mkdtemp(path.join(os.tmpdir(), "rg-browse-"));
  await writeFile(path.join(dir, "a.txt"), "hello", "utf8");
  await mkdir(path.join(dir, "sub"));
});
afterAll(async () => { await app.close(); await daemon.stop(); });

test("GET /api/browse lists entries with IsDir", async () => {
  const res = await app.inject({ method: "GET", url: `/api/browse?remote=${REMOTE}&path=${encodeURIComponent(dir)}` });
  expect(res.statusCode).toBe(200);
  const { entries } = res.json() as { entries: Array<{ Name: string; IsDir: boolean }> };
  expect(entries.find((e) => e.Name === "a.txt")).toMatchObject({ IsDir: false });
  expect(entries.find((e) => e.Name === "sub")).toMatchObject({ IsDir: true });
});

test("mkdir then delete a folder", async () => {
  const mk = await app.inject({ method: "POST", url: "/api/browse/mkdir", payload: { remote: REMOTE, path: dir, name: "made" } });
  expect(mk.statusCode).toBe(201);
  let listed = (await app.inject({ method: "GET", url: `/api/browse?remote=${REMOTE}&path=${encodeURIComponent(dir)}` })).json() as { entries: Array<{ Name: string }> };
  expect(listed.entries.some((e) => e.Name === "made")).toBe(true);

  const del = await app.inject({ method: "POST", url: "/api/browse/delete", payload: { remote: REMOTE, path: dir, name: "made", isDir: true } });
  expect(del.statusCode).toBe(200);
  listed = (await app.inject({ method: "GET", url: `/api/browse?remote=${REMOTE}&path=${encodeURIComponent(dir)}` })).json() as { entries: Array<{ Name: string }> };
  expect(listed.entries.some((e) => e.Name === "made")).toBe(false);
});

test("delete a file", async () => {
  await writeFile(path.join(dir, "gone.txt"), "x", "utf8");
  const del = await app.inject({ method: "POST", url: "/api/browse/delete", payload: { remote: REMOTE, path: dir, name: "gone.txt", isDir: false } });
  expect(del.statusCode).toBe(200);
  const listed = (await app.inject({ method: "GET", url: `/api/browse?remote=${REMOTE}&path=${encodeURIComponent(dir)}` })).json() as { entries: Array<{ Name: string }> };
  expect(listed.entries.some((e) => e.Name === "gone.txt")).toBe(false);
});

test("missing remote is a 400", async () => {
  const res = await app.inject({ method: "GET", url: "/api/browse" });
  expect(res.statusCode).toBe(400);
});
