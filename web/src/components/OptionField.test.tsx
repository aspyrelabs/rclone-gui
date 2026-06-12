import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { OptionField } from "./OptionField.js";
import type { RcOption } from "../api/types.js";

function opt(p: Partial<RcOption>): RcOption {
  return {
    Name: "access_key_id", Help: "AWS Access Key ID.", Default: "", DefaultStr: "",
    Type: "string", Hide: 0, Required: false, IsPassword: false, Advanced: false,
    Exclusive: false, Sensitive: false, ...p,
  };
}

test("renders label, required marker, tooltip and default hint", () => {
  render(<OptionField option={opt({ Required: true, DefaultStr: "us-east-1", Help: "The region." })} value="" onChange={() => {}} />);
  expect(screen.getByText("access_key_id")).toBeInTheDocument();
  expect(screen.getByText("*")).toBeInTheDocument();
  expect(screen.getByText(/default: us-east-1/)).toBeInTheDocument();
  expect(screen.getByLabelText("The region.")).toBeInTheDocument(); // tooltip
});

test("password option renders a masked input", () => {
  const { container } = render(<OptionField option={opt({ IsPassword: true })} value="" onChange={() => {}} />);
  expect(container.querySelector('input[type="password"]')).toBeTruthy();
});

test("text input reports changes", async () => {
  const onChange = vi.fn();
  render(<OptionField option={opt({})} value="" onChange={onChange} />);
  await userEvent.type(screen.getByLabelText(/access_key_id/), "AKIA");
  expect(onChange).toHaveBeenCalled();
});

test("exclusive examples render a select", () => {
  render(<OptionField option={opt({ Exclusive: true, Examples: [{ Value: "us-east-1", Help: "US East" }] })} value="" onChange={() => {}} />);
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /us-east-1/ })).toBeInTheDocument();
});
