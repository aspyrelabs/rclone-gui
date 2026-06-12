import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VersionStatus {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

/** Dependencies injected so the service is unit-testable without network/disk. */
export interface VersionDeps {
  /** Read the currently-installed rclone version (e.g. "v1.74.3"). */
  getInstalled: () => Promise<string | null>;
  /** Fetch the latest released rclone version tag from GitHub. */
  fetchLatest: () => Promise<string | null>;
  /** Download + verify + install the given version onto the config volume. */
  install: (version: string) => Promise<void>;
  /** Called after a successful install (restart daemon, invalidate caches). */
  afterInstall: () => Promise<void>;
}

export class VersionService {
  constructor(private readonly deps: VersionDeps) {}

  async status(): Promise<VersionStatus> {
    const [installed, latest] = await Promise.all([
      this.deps.getInstalled(),
      this.deps.fetchLatest().catch(() => null), // offline => latest unknown, not an error
    ]);
    return {
      installed,
      latest,
      updateAvailable: Boolean(installed && latest && installed !== latest),
    };
  }

  /** Update to the latest version (or a specific one). Returns the new status. */
  async update(version?: string): Promise<VersionStatus> {
    const target = version ?? (await this.deps.fetchLatest());
    if (!target) throw new Error("could not determine latest rclone version");
    await this.deps.install(target);
    await this.deps.afterInstall();
    return this.status();
  }
}

/** Parse the tag_name from the GitHub "latest release" API payload. */
export function parseLatestTag(json: unknown): string | null {
  if (json && typeof json === "object" && "tag_name" in json) {
    const tag = (json as { tag_name: unknown }).tag_name;
    return typeof tag === "string" ? tag : null;
  }
  return null;
}

/** Real GitHub fetch implementation. */
export async function fetchLatestFromGitHub(): Promise<string | null> {
  const res = await fetch("https://api.github.com/repos/rclone/rclone/releases/latest", {
    headers: { accept: "application/vnd.github+json", "user-agent": "rclone-gui" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return parseLatestTag(await res.json());
}

/**
 * Real installer: runs scripts/fetch-rclone.sh (download + SHA256 verify + unzip)
 * with RCLONE_VERSION and DEST_DIR pointed at <configDir>/bin.
 */
export function makeScriptInstaller(scriptPath: string, configDir: string) {
  return async function install(version: string): Promise<void> {
    await execFileAsync("bash", [scriptPath], {
      env: { ...process.env, RCLONE_VERSION: version, DEST_DIR: `${configDir}/bin` },
    });
  };
}
