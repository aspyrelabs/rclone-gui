import { afterAll, beforeAll, expect, test } from "vitest";
import { RcClient, RcError } from "../src/rclone/client.js";
import { RcloneDaemon } from "../src/rclone/daemon.js";
import { startTestDaemon } from "./helpers/rcd.js";

let daemon: RcloneDaemon;
let client: RcClient;
beforeAll(async () => {
  ({ daemon } = await startTestDaemon());
  client = new RcClient(daemon);
});
afterAll(async () => { await daemon.stop(); });

test("call returns the rc result body", async () => {
  const out = await client.call<{ version: string }>("core/version");
  expect(out.version).toMatch(/^v1\./);
});

test("call throws RcError on a bad rc path", async () => {
  await expect(client.call("does/notexist")).rejects.toBeInstanceOf(RcError);
});
