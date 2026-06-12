import { afterEach, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { RcError } from "../src/rclone/client.js";
import { RemoteService } from "../src/rclone/remotes.js";

let app: FastifyInstance;
afterEach(async () => { if (app) await app.close(); });

test("RcError from a route is mapped to a structured response with its status", async () => {
  // Stub RemoteService whose list() throws an RcError(409).
  const stub = Object.create(RemoteService.prototype) as RemoteService;
  (stub as unknown as { list: () => Promise<never> }).list = async () => {
    throw new RcError("boom from rclone", 409, "config/listremotes");
  };
  app = await buildApp({ remotes: stub });
  const res = await app.inject({ method: "GET", url: "/api/remotes" });
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({ error: "boom from rclone", status: 409 });
});

test("a non-RcError yields a 500 structured response", async () => {
  const stub = Object.create(RemoteService.prototype) as RemoteService;
  (stub as unknown as { list: () => Promise<never> }).list = async () => {
    throw new Error("unexpected");
  };
  app = await buildApp({ remotes: stub });
  const res = await app.inject({ method: "GET", url: "/api/remotes" });
  expect(res.statusCode).toBe(500);
  expect((res.json() as { status: number }).status).toBe(500);
});
