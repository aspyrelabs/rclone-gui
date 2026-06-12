import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useJobs } from "./useJobs.js";
import { api } from "../api/client.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

function Probe() { useJobs(1000); return null; }

test("stops polling after unmount", async () => {
  const list = vi.spyOn(api, "listJobs").mockResolvedValue([]);
  const { unmount } = render(<Probe />);
  await act(() => vi.advanceTimersByTimeAsync(0));   // initial fetch
  await act(() => vi.advanceTimersByTimeAsync(1000)); // one interval tick
  const callsBefore = list.mock.calls.length;
  unmount();
  await act(() => vi.advanceTimersByTimeAsync(5000)); // no more ticks should fire
  expect(list.mock.calls.length).toBe(callsBefore);
});
