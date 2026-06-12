import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SchedulesPage } from "./SchedulesPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "loc", type: "local", parameters: {} }]);
}

test("creates a schedule then runs it", async () => {
  setup();
  vi.spyOn(api, "schedules")
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "s1", name: "nightly", type: "copy", isDir: true, src: { remote: "loc", path: "a", name: "" }, dst: { remote: "loc", path: "b", name: "" }, cron: "0 3 * * *", enabled: true }])
    .mockResolvedValue([{ id: "s1", name: "nightly", type: "copy", isDir: true, src: { remote: "loc", path: "a", name: "" }, dst: { remote: "loc", path: "b", name: "" }, cron: "0 3 * * *", enabled: true, lastJobId: 5, lastRun: "2026-01-01" }]);
  const create = vi.spyOn(api, "createSchedule").mockResolvedValue({ id: "s1", name: "nightly", type: "copy", isDir: true, src: { remote: "loc", path: "a", name: "" }, dst: { remote: "loc", path: "b", name: "" }, cron: "0 3 * * *", enabled: true });
  const run = vi.spyOn(api, "runSchedule").mockResolvedValue({ ran: "s1" });

  render(<SchedulesPage />);
  await waitFor(() => expect(screen.getByText("No schedules yet.")).toBeInTheDocument());

  await userEvent.type(screen.getByLabelText("Name"), "nightly");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0][0]).toMatchObject({ name: "nightly", type: "copy", cron: "0 3 * * *", src: { remote: "loc" } });

  await waitFor(() => expect(screen.getByText("nightly")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Run now" }));
  await waitFor(() => expect(run).toHaveBeenCalledWith("s1"));
});

test("applies a cron preset", async () => {
  setup();
  vi.spyOn(api, "schedules").mockResolvedValue([]);
  render(<SchedulesPage />);
  await waitFor(() => expect(screen.getByText("No schedules yet.")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Every hour" }));
  expect((screen.getByLabelText("Cron") as HTMLInputElement).value).toBe("0 * * * *");
});

test("deletes a schedule after confirmation", async () => {
  setup();
  vi.spyOn(api, "schedules")
    .mockResolvedValueOnce([{ id: "s1", name: "x", type: "copy", isDir: true, src: { remote: "loc", path: "", name: "" }, dst: { remote: "loc", path: "", name: "" }, cron: "0 3 * * *", enabled: true }])
    .mockResolvedValue([]);
  const del = vi.spyOn(api, "deleteSchedule").mockResolvedValue({ deleted: "s1" });
  render(<SchedulesPage />);
  await waitFor(() => expect(screen.getByText("x")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("s1"));
});

test("expands a schedule's run history", async () => {
  setup();
  vi.spyOn(api, "schedules").mockResolvedValue([{
    id: "s1", name: "h", type: "copy", isDir: true,
    src: { remote: "loc", path: "", name: "" }, dst: { remote: "loc", path: "", name: "" },
    cron: "0 3 * * *", enabled: true,
    history: [
      { time: "2026-01-02T00:00:00Z", error: "boom" },
      { time: "2026-01-01T00:00:00Z", jobId: 7 },
    ],
  }]);
  render(<SchedulesPage />);
  await waitFor(() => expect(screen.getByText("h")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "History" }));
  await waitFor(() => expect(screen.getByText(/job 7/)).toBeInTheDocument());
  expect(screen.getByText(/error: boom/)).toBeInTheDocument();
});
