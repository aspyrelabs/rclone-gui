import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MountsPage } from "./MountsPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "loc", type: "local", parameters: {} }]);
  vi.spyOn(api, "mountTypes").mockResolvedValue(["nfsmount", "cmount"]);
}

test("shows the FUSE note and lists no mounts initially", async () => {
  setup();
  vi.spyOn(api, "mounts").mockResolvedValue([]);
  render(<MountsPage />);
  expect(screen.getByText(/FUSE/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("No active mounts.")).toBeInTheDocument());
});

test("mounts and then unmounts", async () => {
  setup();
  vi.spyOn(api, "mounts")
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ fs: "loc:data", mountPoint: "/mnt/x" }])
    .mockResolvedValue([]);
  const mount = vi.spyOn(api, "mount").mockResolvedValue({ mounted: "/mnt/x" });
  const unmount = vi.spyOn(api, "unmount").mockResolvedValue({ unmounted: "/mnt/x" });

  render(<MountsPage />);
  await waitFor(() => expect(screen.getByText("No active mounts.")).toBeInTheDocument());

  await userEvent.type(screen.getByLabelText("Path"), "data");
  await userEvent.type(screen.getByLabelText("Mount point"), "/mnt/x");
  await userEvent.click(screen.getByRole("button", { name: "Mount" }));
  await waitFor(() => expect(mount).toHaveBeenCalledWith({ remote: "loc", path: "data", mountPoint: "/mnt/x", mountType: undefined }));
  await waitFor(() => expect(screen.getByText("/mnt/x")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Unmount" }));
  await waitFor(() => expect(unmount).toHaveBeenCalledWith("/mnt/x"));
});
