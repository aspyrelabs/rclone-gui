import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ServePage } from "./ServePage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(api, "remotes").mockResolvedValue([{ name: "loc", type: "local", parameters: {} }]);
  vi.spyOn(api, "serveTypes").mockResolvedValue(["http", "webdav", "sftp"]);
}

test("starts a serve and shows it, then stops it", async () => {
  setup();
  const serves = vi.spyOn(api, "serves")
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "http-1", addr: "0.0.0.0:8080", type: "http", fs: "loc:" }])
    .mockResolvedValue([]);
  const start = vi.spyOn(api, "startServe").mockResolvedValue({ id: "http-1", addr: "0.0.0.0:8080" });
  const stop = vi.spyOn(api, "stopServe").mockResolvedValue({ stopped: "http-1" });

  render(<ServePage />);
  await waitFor(() => expect(screen.getByText("No active serves.")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Start serve" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith({ type: "http", remote: "loc", path: "", addr: "0.0.0.0:8080" }));
  await waitFor(() => expect(screen.getByText("loc:")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(stop).toHaveBeenCalledWith("http-1"));
  void serves;
});
