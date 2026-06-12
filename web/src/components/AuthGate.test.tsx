import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthGate } from "./AuthGate.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

test("shows login when protected and unauthenticated, then renders children after login", async () => {
  const statusSpy = vi.spyOn(api, "authStatus")
    .mockResolvedValueOnce({ protected: true, authenticated: false })
    .mockResolvedValueOnce({ protected: true, authenticated: true });
  vi.spyOn(api, "login").mockResolvedValue({ authenticated: true });

  render(<AuthGate>{() => <div>secret content</div>}</AuthGate>);

  await waitFor(() => expect(screen.getByText("Sign in")).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText("Password"), "hunter2");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));

  await waitFor(() => expect(screen.getByText("secret content")).toBeInTheDocument());
  expect(statusSpy).toHaveBeenCalledTimes(2);
});

test("renders children directly when unprotected", async () => {
  vi.spyOn(api, "authStatus").mockResolvedValue({ protected: false, authenticated: true });
  render(<AuthGate>{() => <div>open content</div>}</AuthGate>);
  await waitFor(() => expect(screen.getByText("open content")).toBeInTheDocument());
});
