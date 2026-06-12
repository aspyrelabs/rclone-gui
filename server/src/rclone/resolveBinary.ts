import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve which rclone binary to run, in priority order:
 *  1. explicit override (config.rcloneBinary)
 *  2. self-updated binary on the config volume (configDir/bin/rclone)
 *  3. local dev binary (./.rclone/rclone)
 *  4. "rclone" on PATH
 */
export function resolveRcloneBinary(opts: {
  override?: string | null;
  configDir?: string;
  cwd?: string;
}): string {
  if (opts.override) return opts.override;
  const candidates: string[] = [];
  if (opts.configDir) candidates.push(path.join(opts.configDir, "bin", "rclone"));
  candidates.push(path.join(opts.cwd ?? process.cwd(), ".rclone", "rclone"));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "rclone";
}

/** Parse the semantic version (e.g. "v1.74.3") from `rclone version` output. */
export function parseRcloneVersion(stdout: string): string | null {
  const m = stdout.match(/rclone\s+(v\d+\.\d+\.\d+\S*)/);
  return m ? m[1] : null;
}

export async function getRcloneVersion(binary: string): Promise<string | null> {
  const { stdout } = await execFileAsync(binary, ["version"]);
  return parseRcloneVersion(stdout);
}
