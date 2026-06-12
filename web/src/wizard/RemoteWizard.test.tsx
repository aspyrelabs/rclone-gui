import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RemoteWizard } from "./RemoteWizard.js";
import { api } from "../api/client.js";
import type { RcProvider } from "../api/types.js";

afterEach(() => vi.restoreAllMocks());

const s3: RcProvider = {
  Name: "s3",
  Description: "Amazon S3 and compatible",
  Hide: false,
  Options: [
    {
      Name: "access_key_id", Help: "AWS Access Key ID.", Default: "", DefaultStr: "",
      Type: "string", Hide: 0, Required: true, IsPassword: false, Advanced: false,
      Exclusive: false, Sensitive: false,
    },
    {
      Name: "chunk_size", Help: "Chunk size.", Default: "5Mi", DefaultStr: "5Mi",
      Type: "SizeSuffix", Hide: 0, Required: false, IsPassword: false, Advanced: true,
      Exclusive: false, Sensitive: false,
    },
  ],
};

test("create flow: pick backend, name, fill basic, save", async () => {
  vi.spyOn(api, "providers").mockResolvedValue([s3]);
  const create = vi.spyOn(api, "createRemote").mockResolvedValue({ created: "mys3" });
  const onSaved = vi.fn();

  render(<RemoteWizard existing={[]} onClose={() => {}} onSaved={onSaved} />);

  await waitFor(() => expect(screen.getByText("s3")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("radio"));
  await userEvent.type(screen.getByLabelText(/Remote name/), "mys3");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  await userEvent.type(screen.getByLabelText(/access_key_id/), "AKIA123");
  await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(create).toHaveBeenCalledWith("mys3", "s3", { access_key_id: "AKIA123" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

test("rejects a duplicate remote name", async () => {
  vi.spyOn(api, "providers").mockResolvedValue([s3]);
  render(<RemoteWizard existing={[{ name: "dup", type: "s3", parameters: {} }]} onClose={() => {}} onSaved={() => {}} />);
  await waitFor(() => expect(screen.getByText("s3")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("radio"));
  await userEvent.type(screen.getByLabelText(/Remote name/), "dup");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/already exists/)).toBeInTheDocument();
});

test("edit mode: starts on basic, prefilled, and saves full params (including cleared)", async () => {
  vi.spyOn(api, "providers").mockResolvedValue([s3]);
  const update = vi.spyOn(api, "updateRemote").mockResolvedValue({ updated: "mys3" });
  const onSaved = vi.fn();

  render(
    <RemoteWizard
      editName="mys3"
      existing={[{ name: "mys3", type: "s3", parameters: { access_key_id: "OLD", region: "us-east-1" } }]}
      onClose={() => {}}
      onSaved={onSaved}
    />,
  );

  // Starts on the basic step with the field prefilled.
  const akid = await screen.findByLabelText(/access_key_id/);
  expect(akid).toHaveValue("OLD");

  // Clear the field (user intends to unset it).
  await userEvent.clear(akid);

  await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  // Cleared key must be present (as "") so the backend can unset it — not silently dropped.
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith("mys3", { access_key_id: "", region: "us-east-1" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

test("pending step drives the continue flow", async () => {
  vi.spyOn(api, "providers").mockResolvedValue([s3]);
  vi.spyOn(api, "createRemote").mockResolvedValue({
    pending: { State: "*oauth", Option: { Name: "config_token", Help: "Paste token", Default: "", DefaultStr: "", Type: "string", Hide: 0, Required: true, IsPassword: false, Advanced: false, Exclusive: false, Sensitive: false } },
  });
  const cont = vi.spyOn(api, "continueRemote").mockResolvedValue({ created: "mys3" });
  const onSaved = vi.fn();

  render(<RemoteWizard existing={[]} onClose={() => {}} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByText("s3")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("radio"));
  await userEvent.type(screen.getByLabelText(/Remote name/), "mys3");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.getByLabelText(/config_token/)).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText(/config_token/), "tok123");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(cont).toHaveBeenCalledWith("mys3", "*oauth", "tok123"));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});
