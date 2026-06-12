import { afterEach, expect, test, vi } from "vitest";
import { api } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

test("browse() unwraps entries and encodes params", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ entries: [{ Name: "a.txt", IsDir: false }] }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  const entries = await api.browse("my remote", "a/b");
  expect(entries).toEqual([{ Name: "a.txt", IsDir: false }]);
  const [url] = spy.mock.calls[0] as unknown as [string];
  expect(url).toBe("/api/browse?remote=my%20remote&path=a%2Fb");
});

test("launchJob posts the launch input", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ jobid: 7 }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  const out = await api.launchJob({ type: "copy", isDir: true, src: { remote: "a", path: "", name: "d" }, dst: { remote: "b", path: "", name: "d" } });
  expect(out).toEqual({ jobid: 7 });
  const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toMatchObject({ type: "copy", src: { remote: "a" } });
});

test("stopJob posts to the stop route", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ stopped: 7 }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.stopJob(7);
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/jobs/7/stop");
  expect(init.method).toBe("POST");
});
