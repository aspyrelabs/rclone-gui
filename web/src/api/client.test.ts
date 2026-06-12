import { afterEach, expect, test, vi } from "vitest";
import { ApiError, api } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

test("remotes() unwraps the remotes array", async () => {
  mockFetch(200, { remotes: [{ name: "a", type: "local", parameters: {} }] });
  const out = await api.remotes();
  expect(out).toEqual([{ name: "a", type: "local", parameters: {} }]);
});

test("non-2xx throws ApiError with the server error message and status", async () => {
  mockFetch(400, { error: "invalid remote name", status: 400 });
  await expect(api.createRemote("bad name", "local", {})).rejects.toMatchObject({
    name: "ApiError",
    message: "invalid remote name",
    status: 400,
  });
  void ApiError;
});

test("createRemote posts name/type/parameters as JSON", async () => {
  const spy = vi.fn(async () => new Response(JSON.stringify({ created: "x" }), { status: 201 }));
  globalThis.fetch = spy as unknown as typeof fetch;
  await api.createRemote("x", "s3", { provider: "AWS" });
  const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual({ name: "x", type: "s3", parameters: { provider: "AWS" } });
});
