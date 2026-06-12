import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import { RcloneDaemon } from "../../src/rclone/daemon.js";
import { resolveRcloneBinary } from "../../src/rclone/resolveBinary.js";

const here = path.dirname(fileURLToPath(import.meta.url)); // server/test/helpers
const repoRoot = path.resolve(here, "../../.."); // repo root

export async function startTestDaemon(): Promise<{ daemon: RcloneDaemon; configPath: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rclone-gui-test-"));
  const configPath = path.join(dir, "rclone.conf");
  await writeFile(configPath, "", "utf8");
  const binary = resolveRcloneBinary({ cwd: repoRoot });
  const daemon = new RcloneDaemon({ binary, configPath });
  await daemon.start();
  return { daemon, configPath };
}
