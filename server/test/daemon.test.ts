import { afterAll, beforeAll, expect, test } from "vitest";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
beforeAll(async () => { ({ daemon } = await startTestDaemon()); });
afterAll(async () => { await daemon.stop(); });

test("daemon exposes an authenticated endpoint that answers rc/noop", async () => {
  const ep = daemon.getEndpoint();
  expect(ep.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const res = await fetch(`${ep.url}/rc/noop`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Basic " + Buffer.from(`${ep.user}:${ep.pass}`).toString("base64"),
    },
    body: "{}",
  });
  expect(res.ok).toBe(true);
});

test("requests without auth are rejected", async () => {
  const ep = daemon.getEndpoint();
  const res = await fetch(`${ep.url}/rc/noop`, { method: "POST", body: "{}" });
  expect(res.status).toBe(401);
});
