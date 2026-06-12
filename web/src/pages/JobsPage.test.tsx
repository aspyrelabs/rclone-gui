import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { JobsPage } from "./JobsPage.js";
import { api } from "../api/client.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("renders a running job with progress and a Stop button", async () => {
  vi.spyOn(api, "listJobs").mockResolvedValue([
    { id: 3, type: "copy", src: "loc:docs/a.txt", dst: "s3:backup/a.txt", finished: false, success: false, error: "", bytes: 50, totalBytes: 100, transfers: 0, totalTransfers: 1, speed: 1024, eta: 1 },
  ]);
  const stop = vi.spyOn(api, "stopJob").mockResolvedValue({ stopped: 3 });

  render(<JobsPage />);
  // flush the initial refresh() promise and resulting React state update
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText(/loc:docs\/a\.txt/)).toBeInTheDocument();
  expect(screen.getByText(/running/)).toBeInTheDocument();

  screen.getByRole("button", { name: "Stop" }).click();
  expect(stop).toHaveBeenCalledWith(3);
});

test("shows the empty hint when there are no jobs", async () => {
  vi.spyOn(api, "listJobs").mockResolvedValue([]);
  render(<JobsPage />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText(/No jobs yet/)).toBeInTheDocument();
});
