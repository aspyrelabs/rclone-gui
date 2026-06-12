import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RemotesPage } from "./RemotesPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

test("lists remotes and deletes one after confirmation", async () => {
  vi.spyOn(api, "remotes")
    .mockResolvedValueOnce([{ name: "gdrive", type: "drive", parameters: {} }])
    .mockResolvedValueOnce([]);
  const del = vi.spyOn(api, "deleteRemote").mockResolvedValue({ deleted: "gdrive" });

  render(<RemotesPage />);
  await waitFor(() => expect(screen.getByText("gdrive")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

  await waitFor(() => expect(del).toHaveBeenCalledWith("gdrive"));
  await waitFor(() => expect(screen.queryByText("gdrive")).not.toBeInTheDocument());
});

test("Test button shows ok status", async () => {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "s3", type: "s3", parameters: {} }]);
  vi.spyOn(api, "testRemote").mockResolvedValue({ ok: true });
  render(<RemotesPage />);
  await waitFor(() => expect(screen.getByText("s3")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Test" }));
  await waitFor(() => expect(screen.getByText("● ok")).toBeInTheDocument());
});
