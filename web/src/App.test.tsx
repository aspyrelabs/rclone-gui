import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import App from "./App.js";
import { api } from "./api/client.js";

afterEach(() => vi.restoreAllMocks());

test("renders the shell and unprotected banner when auth is off", async () => {
  vi.spyOn(api, "authStatus").mockResolvedValue({ protected: false, authenticated: true });
  vi.spyOn(api, "remotes").mockResolvedValue([]);
  render(<App />);
  await waitFor(() => expect(screen.getByText("⛅ rclone GUI")).toBeInTheDocument());
  expect(screen.getByRole("alert")).toHaveTextContent(/Running unprotected/);
});
