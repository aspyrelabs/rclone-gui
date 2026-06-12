import { expect, test } from "vitest";
import { controlKind, matchesProvider, partitionOptions } from "./optionVisibility.js";
import type { RcOption } from "../api/types.js";

function opt(p: Partial<RcOption>): RcOption {
  return {
    Name: "x", Help: "", Default: "", DefaultStr: "", Type: "string",
    Hide: 0, Required: false, IsPassword: false, Advanced: false,
    Exclusive: false, Sensitive: false, ...p,
  };
}

test("controlKind maps types and flags", () => {
  expect(controlKind(opt({ Type: "bool" }))).toBe("bool");
  expect(controlKind(opt({ IsPassword: true }))).toBe("password");
  expect(controlKind(opt({ Sensitive: true }))).toBe("password");
  expect(controlKind(opt({ Type: "int" }))).toBe("number");
  expect(controlKind(opt({ Examples: [{ Value: "a", Help: "" }], Exclusive: true }))).toBe("select");
  expect(controlKind(opt({ Examples: [{ Value: "a", Help: "" }], Exclusive: false }))).toBe("suggest");
  expect(controlKind(opt({ Type: "string" }))).toBe("text");
});

test("matchesProvider handles include, negate, and empty filters", () => {
  expect(matchesProvider(opt({ Provider: "" }), "AWS")).toBe(true);
  expect(matchesProvider(opt({ Provider: "AWS,Minio" }), "AWS")).toBe(true);
  expect(matchesProvider(opt({ Provider: "AWS,Minio" }), "Ceph")).toBe(false);
  expect(matchesProvider(opt({ Provider: "!AWS" }), "AWS")).toBe(false);
  expect(matchesProvider(opt({ Provider: "!AWS" }), "Ceph")).toBe(true);
  expect(matchesProvider(opt({ Provider: "AWS" }), undefined)).toBe(true);
});

test("partitionOptions splits basic/advanced and drops hidden", () => {
  const { basic, advanced } = partitionOptions(
    [opt({ Name: "a" }), opt({ Name: "b", Advanced: true }), opt({ Name: "c", Hide: 1 })],
    undefined,
  );
  expect(basic.map((o) => o.Name)).toEqual(["a"]);
  expect(advanced.map((o) => o.Name)).toEqual(["b"]);
});
