import type { RcOption } from "../api/types.js";

export type ControlKind = "bool" | "select" | "suggest" | "password" | "number" | "text";

const NUMERIC = new Set(["int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64"]);

/** Decide which input control an option should render as. */
export function controlKind(o: RcOption): ControlKind {
  if (o.IsPassword || o.Sensitive) return "password";
  if (o.Type === "bool") return "bool";
  if (o.Examples && o.Examples.length > 0) return o.Exclusive ? "select" : "suggest";
  if (NUMERIC.has(o.Type)) return "number";
  return "text";
}

/** Hidden options (Hide !== 0) are never shown. */
export function isVisible(o: RcOption, providerValue: string | undefined): boolean {
  if (o.Hide !== 0) return false;
  return matchesProvider(o, providerValue);
}

/**
 * Provider filtering: an option with a Provider filter only applies to certain
 * provider sub-types. rclone's convention: a comma-separated list, optionally
 * negated with a leading "!". Empty filter => applies to all.
 */
export function matchesProvider(o: RcOption, providerValue: string | undefined): boolean {
  const filter = o.Provider ?? "";
  if (filter === "") return true;
  if (!providerValue) return true; // no provider chosen yet => don't hide
  let negate = false;
  let list = filter;
  if (list.startsWith("!")) { negate = true; list = list.slice(1); }
  const set = list.split(",").map((s) => s.trim()).filter(Boolean);
  const included = set.includes(providerValue);
  return negate ? !included : included;
}

/** Split visible options into basic and advanced, applying provider filtering. */
export function partitionOptions(
  options: RcOption[],
  providerValue: string | undefined,
): { basic: RcOption[]; advanced: RcOption[] } {
  const visible = options.filter((o) => isVisible(o, providerValue));
  return {
    basic: visible.filter((o) => !o.Advanced),
    advanced: visible.filter((o) => o.Advanced),
  };
}
