import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useRemotes } from "./useRemotes.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { remotes, loading } = useRemotes();
  if (loading) return <div>loading</div>;
  return <ul>{remotes.map((r) => <li key={r.name}>{r.name}</li>)}</ul>;
}

test("useRemotes loads remotes from the api", async () => {
  vi.spyOn(api, "remotes").mockResolvedValue([
    { name: "gdrive", type: "drive", parameters: {} },
  ]);
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("gdrive")).toBeInTheDocument());
});
