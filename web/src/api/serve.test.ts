import { afterEach, expect, test, vi } from "vitest";
import { api } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

test("serves() unwraps the serves array", async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ serves: [{ id: "http-1", addr: "127.0.0.1:8080", type: "http", fs: "loc:" }] }), { status: 200 })) as unknown as typeof fetch;
  expect(await api.serves()).toEqual([{ id: "http-1", addr: "127.0.0.1:8080", type: "http", fs: "loc:" }]);
});

test("startServe posts the body", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ id: "http-2", addr: "x" }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.startServe({ type: "http", remote: "loc", path: "d", addr: "0.0.0.0:8080" });
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/serve");
  expect(JSON.parse(init.body as string)).toEqual({ type: "http", remote: "loc", path: "d", addr: "0.0.0.0:8080" });
});

test("unmount posts the mountPoint", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ unmounted: "/mnt/x" }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.unmount("/mnt/x");
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/mounts/unmount");
  expect(JSON.parse(init.body as string)).toEqual({ mountPoint: "/mnt/x" });
});
