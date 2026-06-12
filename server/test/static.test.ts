import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "rg-web-"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>rclone GUI</title>", "utf8");
  await writeFile(path.join(dir, "app.js"), "console.log('hi')", "utf8");
  app = await buildApp({ webRoot: dir });
});
afterAll(async () => { await app.close(); });

test("serves index.html at root", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("rclone GUI");
});

test("serves static asset files", async () => {
  const res = await app.inject({ method: "GET", url: "/app.js" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("console.log");
});

test("unknown non-api GET falls back to index.html (SPA routing)", async () => {
  const res = await app.inject({ method: "GET", url: "/settings" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("rclone GUI");
});

test("unknown /api route returns JSON 404, not html", async () => {
  const res = await app.inject({ method: "GET", url: "/api/nope" });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ status: 404 });
});

test("health still works alongside static", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
});
