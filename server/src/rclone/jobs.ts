import { randomUUID } from "node:crypto";
import type { RcClient } from "./client.js";
import { fsString } from "./browse.js";

export type JobType = "copy" | "move";

export interface PathRef {
  remote: string;
  path: string; // parent directory ("" = root)
  name: string; // leaf file/dir name ("" = the directory itself / its contents)
}

export interface LaunchInput {
  type: JobType;
  src: PathRef;
  dst: PathRef;
  isDir: boolean;
}

export interface JobInfo {
  id: number;
  type: JobType;
  src: string;
  dst: string;
  finished: boolean;
  success: boolean;
  error: string;
  bytes: number;
  totalBytes: number;
  transfers: number;
  totalTransfers: number;
  speed: number;
  eta: number | null;
}

interface JobRecord {
  id: number;
  type: JobType;
  src: string;
  dst: string;
  group: string;
}

function joinPath(parent: string, name: string): string {
  if (!name) return parent; // copying a whole directory's contents
  return parent ? `${parent}/${name}` : name;
}

export class JobService {
  private readonly records = new Map<number, JobRecord>();

  constructor(private readonly client: RcClient) {}

  async launch(input: LaunchInput): Promise<{ jobid: number }> {
    const { type, src, dst, isDir } = input;
    const group = `gui-${randomUUID()}`;
    const srcLabel = `${src.remote}:${joinPath(src.path, src.name)}`;
    const dstLabel = `${dst.remote}:${joinPath(dst.path, dst.name)}`;

    let jobid: number;
    if (isDir) {
      const rcPath = type === "move" ? "sync/move" : "sync/copy";
      const out = await this.client.call<{ jobid: number }>(rcPath, {
        srcFs: fsString(src.remote, joinPath(src.path, src.name)),
        dstFs: fsString(dst.remote, joinPath(dst.path, dst.name)),
        _async: true,
        _group: group,
      });
      jobid = out.jobid;
    } else {
      const rcPath = type === "move" ? "operations/movefile" : "operations/copyfile";
      const out = await this.client.call<{ jobid: number }>(rcPath, {
        srcFs: fsString(src.remote, src.path),
        srcRemote: src.name,
        dstFs: fsString(dst.remote, dst.path),
        dstRemote: dst.name,
        _async: true,
        _group: group,
      });
      jobid = out.jobid;
    }

    this.records.set(jobid, { id: jobid, type, src: srcLabel, dst: dstLabel, group });
    return { jobid };
  }

  async list(): Promise<JobInfo[]> {
    type StatsResult = { bytes?: number; totalBytes?: number; transfers?: number; totalTransfers?: number; speed?: number; eta?: number | null };
    const infos = await Promise.all(
      Array.from(this.records.values()).map(async (rec) => {
        const [status, stats] = await Promise.all([
          this.client
            .call<{ finished?: boolean; success?: boolean; error?: string }>("job/status", { jobid: rec.id })
            .catch(() => ({} as { finished?: boolean; success?: boolean; error?: string })),
          this.client
            .call<StatsResult>("core/stats", { group: rec.group })
            .catch((): StatsResult => ({})),
        ]);
        return {
          id: rec.id,
          type: rec.type,
          src: rec.src,
          dst: rec.dst,
          finished: Boolean(status.finished),
          success: Boolean(status.success),
          error: status.error ?? "",
          bytes: stats.bytes ?? 0,
          totalBytes: stats.totalBytes ?? 0,
          transfers: stats.transfers ?? 0,
          totalTransfers: stats.totalTransfers ?? 0,
          speed: stats.speed ?? 0,
          eta: stats.eta ?? null,
        };
      }),
    );
    return infos.sort((a, b) => b.id - a.id);
  }

  async stop(jobid: number): Promise<void> {
    await this.client.call("job/stop", { jobid });
  }
}
