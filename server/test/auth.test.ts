import { afterEach, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
afterEach(async () => { if (app) await app.close(); });

test("open mode: status reports unprotected and /api is reachable", async () => {
  app = await buildApp({ guiPassword: null });
  const status = await app.inject({ method: "GET", url: "/api/auth/status" });
  expect(status.json()).toEqual({ protected: false, authenticated: true });
});

test("protected mode: blocks until login, then allows with cookie", async () => {
  app = await buildApp({ guiPassword: "s3cret" });

  const blocked = await app.inject({ method: "GET", url: "/api/remotes" });
  expect(blocked.statusCode).toBe(401);

  const badLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "nope" } });
  expect(badLogin.statusCode).toBe(401);

  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "s3cret" } });
  expect(login.statusCode).toBe(200);
  const cookie = login.cookies[0];
  expect(cookie.name).toBe("rg_session");

  const allowed = await app.inject({
    method: "GET", url: "/api/remotes",
    cookies: { [cookie.name]: cookie.value },
  });
  // No remotes service registered here, so 404 (route absent) — but NOT 401.
  expect(allowed.statusCode).not.toBe(401);
});
