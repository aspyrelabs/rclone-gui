import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { BrowsePage } from "./BrowsePage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function mockRemotes() {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "loc", type: "local", parameters: {} }]);
}

test("lists entries for the default remote and navigates into a folder", async () => {
  mockRemotes();
  const browse = vi.spyOn(api, "browse")
    .mockResolvedValueOnce([
      { Path: "sub", Name: "sub", Size: 0, ModTime: "", IsDir: true, MimeType: "" },
      { Path: "a.txt", Name: "a.txt", Size: 5, ModTime: "", IsDir: false, MimeType: "" },
    ])
    .mockResolvedValueOnce([
      { Path: "b.txt", Name: "b.txt", Size: 2, ModTime: "", IsDir: false, MimeType: "" },
    ]);

  render(<BrowsePage />);
  await waitFor(() => expect(screen.getByText("📁 sub")).toBeInTheDocument());

  await userEvent.click(screen.getByText("📁 sub"));
  await waitFor(() => expect(screen.getByText("📄 b.txt")).toBeInTheDocument());
  expect(browse).toHaveBeenLastCalledWith("loc", "sub");
});

test("delete asks for confirmation then calls deletePath", async () => {
  mockRemotes();
  vi.spyOn(api, "browse").mockResolvedValue([
    { Path: "a.txt", Name: "a.txt", Size: 5, ModTime: "", IsDir: false, MimeType: "" },
  ]);
  const del = vi.spyOn(api, "deletePath").mockResolvedValue({ deleted: "a.txt" });

  render(<BrowsePage />);
  await waitFor(() => expect(screen.getByText("📄 a.txt")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("loc", "", "a.txt", false));
});

test("breadcrumb navigates back up the tree", async () => {
  mockRemotes();
  vi.spyOn(api, "browse")
    .mockResolvedValueOnce([{ Path: "x", Name: "x", Size: 0, ModTime: "", IsDir: true, MimeType: "" }]) // root
    .mockResolvedValueOnce([{ Path: "y", Name: "y", Size: 0, ModTime: "", IsDir: true, MimeType: "" }]) // x
    .mockResolvedValue([{ Path: "z.txt", Name: "z.txt", Size: 1, ModTime: "", IsDir: false, MimeType: "" }]); // back at root or deeper
  render(<BrowsePage />);
  await waitFor(() => expect(screen.getByText("📁 x")).toBeInTheDocument());
  await userEvent.click(screen.getByText("📁 x"));
  await waitFor(() => expect(screen.getByText("📁 y")).toBeInTheDocument());
  // click the remote-root breadcrumb to go back to root
  await userEvent.click(screen.getByRole("button", { name: "loc:" }));
  await waitFor(() => expect(api.browse).toHaveBeenLastCalledWith("loc", ""));
});

test("shows an error when listing fails", async () => {
  mockRemotes();
  vi.spyOn(api, "browse").mockRejectedValue(new Error("boom listing"));
  render(<BrowsePage />);
  await waitFor(() => expect(screen.getByText("boom listing")).toBeInTheDocument());
});
