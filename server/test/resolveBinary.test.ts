import { expect, test } from "vitest";
import { parseRcloneVersion, resolveRcloneBinary } from "../src/rclone/resolveBinary.js";

test("parseRcloneVersion extracts the version", () => {
  expect(parseRcloneVersion("rclone v1.75.0\n- os/version: ...")).toBe("v1.75.0");
  expect(parseRcloneVersion("rclone v1.75.0-beta.123")).toBe("v1.75.0-beta.123");
  expect(parseRcloneVersion("garbage")).toBeNull();
});

test("resolveRcloneBinary honors the explicit override", () => {
  expect(resolveRcloneBinary({ override: "/custom/rclone" })).toBe("/custom/rclone");
});

test("resolveRcloneBinary falls back to PATH when nothing exists", () => {
  expect(resolveRcloneBinary({ configDir: "/nonexistent", cwd: "/nonexistent" })).toBe("rclone");
});
