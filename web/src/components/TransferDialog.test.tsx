import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { TransferDialog } from "./TransferDialog.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

test("launches a copy job to the chosen destination", async () => {
  const launch = vi.spyOn(api, "launchJob").mockResolvedValue({ jobid: 1 });
  const onLaunched = vi.fn();
  render(
    <TransferDialog
      type="copy"
      src={{ remote: "loc", path: "docs", name: "a.txt" }}
      isDir={false}
      remotes={["loc", "s3"]}
      onClose={() => {}}
      onLaunched={onLaunched}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Destination remote"), "s3");
  await userEvent.clear(screen.getByLabelText(/Destination folder/));
  await userEvent.type(screen.getByLabelText(/Destination folder/), "backup");
  await userEvent.click(screen.getByRole("button", { name: "Start copy" }));

  await waitFor(() => expect(launch).toHaveBeenCalledWith({
    type: "copy",
    isDir: false,
    src: { remote: "loc", path: "docs", name: "a.txt" },
    dst: { remote: "s3", path: "backup", name: "a.txt" },
  }));
  await waitFor(() => expect(onLaunched).toHaveBeenCalled());
});

test("launches a move job with type=move", async () => {
  const launch = vi.spyOn(api, "launchJob").mockResolvedValue({ jobid: 2 });
  render(
    <TransferDialog type="move" src={{ remote: "loc", path: "", name: "d" }} isDir={true} remotes={["loc"]} onClose={() => {}} onLaunched={() => {}} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Start move" }));
  await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: "move", isDir: true })));
});
