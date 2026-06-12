import { afterEach, expect, test, vi } from "vitest";
import { api } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

test("schedules() unwraps the array", async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ schedules: [{ id: "s1", name: "n" }] }), { status: 200 })) as unknown as typeof fetch;
  expect(await api.schedules()).toEqual([{ id: "s1", name: "n" }]);
});

test("createSchedule posts the input and unwraps schedule", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ schedule: { id: "s2" } }), { status: 201 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  const input = { name: "n", type: "copy" as const, isDir: true, src: { remote: "a", path: "", name: "" }, dst: { remote: "b", path: "", name: "" }, cron: "0 3 * * *", enabled: true };
  const out = await api.createSchedule(input);
  expect(out).toEqual({ id: "s2" });
  const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/schedules");
  expect(JSON.parse(init.body as string)).toEqual(input);
});

test("runSchedule posts to the run route", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ ran: "s1" }), { status: 200 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.runSchedule("s1");
  const [url] = spy.mock.calls[0] as unknown as [string];
  expect(url).toBe("/api/schedules/s1/run");
});
