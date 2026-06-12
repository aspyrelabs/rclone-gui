import { expect, test, vi } from "vitest";
import { VersionService, parseLatestTag } from "../src/rclone/version.js";

test("parseLatestTag extracts tag_name", () => {
  expect(parseLatestTag({ tag_name: "v1.74.3" })).toBe("v1.74.3");
  expect(parseLatestTag({})).toBeNull();
  expect(parseLatestTag(null)).toBeNull();
});

test("status reports updateAvailable when installed != latest", async () => {
  const svc = new VersionService({
    getInstalled: async () => "v1.74.3",
    fetchLatest: async () => "v1.75.0",
    install: async () => {},
    afterInstall: async () => {},
  });
  expect(await svc.status()).toEqual({ installed: "v1.74.3", latest: "v1.75.0", updateAvailable: true });
});

test("status: offline latest is null, not an error, and not an update", async () => {
  const svc = new VersionService({
    getInstalled: async () => "v1.74.3",
    fetchLatest: async () => { throw new Error("offline"); },
    install: async () => {},
    afterInstall: async () => {},
  });
  expect(await svc.status()).toEqual({ installed: "v1.74.3", latest: null, updateAvailable: false });
});

test("update installs the latest version then runs afterInstall", async () => {
  const order: string[] = [];
  const install = vi.fn(async (v: string) => { order.push(`install:${v}`); });
  const afterInstall = vi.fn(async () => { order.push("after"); });
  const svc = new VersionService({
    getInstalled: async () => "v1.75.0",
    fetchLatest: async () => "v1.75.0",
    install,
    afterInstall,
  });
  const status = await svc.update();
  expect(install).toHaveBeenCalledWith("v1.75.0");
  expect(order).toEqual(["install:v1.75.0", "after"]);
  expect(status.installed).toBe("v1.75.0");
});

test("update throws if no version can be determined", async () => {
  const svc = new VersionService({
    getInstalled: async () => null,
    fetchLatest: async () => null,
    install: async () => {},
    afterInstall: async () => {},
  });
  await expect(svc.update()).rejects.toThrow(/could not determine/);
});
