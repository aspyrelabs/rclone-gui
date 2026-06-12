import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

const OFF = { rate: "off", bytesPerSecond: -1, bytesPerSecondRx: -1, bytesPerSecondTx: -1 };

test("shows version + offers update; bandwidth shows unlimited", async () => {
  vi.spyOn(api, "version").mockResolvedValue({ installed: "v1.74.3", latest: "v1.75.0", updateAvailable: true });
  vi.spyOn(api, "updateRclone").mockResolvedValue({ installed: "v1.75.0", latest: "v1.75.0", updateAvailable: false });
  vi.spyOn(api, "bwlimit").mockResolvedValue(OFF);

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText("v1.74.3")).toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByText(/unlimited/).length).toBeGreaterThan(0));

  await userEvent.click(screen.getByRole("button", { name: /Update to v1.75.0/ }));
  await waitFor(() => expect(screen.getByText("Up to date.")).toBeInTheDocument());
});

test("applies a bandwidth limit", async () => {
  vi.spyOn(api, "version").mockResolvedValue({ installed: "v1.75.0", latest: "v1.75.0", updateAvailable: false });
  vi.spyOn(api, "bwlimit").mockResolvedValue(OFF);
  const setBw = vi.spyOn(api, "setBwlimit").mockResolvedValue({ rate: "1Mi", bytesPerSecond: 1048576, bytesPerSecondRx: 1048576, bytesPerSecondTx: 1048576 });

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getAllByText(/unlimited/).length).toBeGreaterThan(0));

  await userEvent.type(screen.getByLabelText("Bandwidth rate"), "1M");
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(setBw).toHaveBeenCalledWith("1M"));
  await waitFor(() => expect(screen.getByText("1Mi")).toBeInTheDocument());
});

test("set unlimited posts off", async () => {
  vi.spyOn(api, "version").mockResolvedValue({ installed: "v1.75.0", latest: "v1.75.0", updateAvailable: false });
  vi.spyOn(api, "bwlimit").mockResolvedValue({ rate: "1Mi", bytesPerSecond: 1048576, bytesPerSecondRx: 1048576, bytesPerSecondTx: 1048576 });
  const setBw = vi.spyOn(api, "setBwlimit").mockResolvedValue(OFF);

  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText("1Mi")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Set unlimited" }));
  await waitFor(() => expect(setBw).toHaveBeenCalledWith("off"));
});
