import type { RcClient } from "./client.js";
import { fsString } from "./browse.js";

export interface MountInstance {
  fs: string;
  mountPoint: string;
}

export class MountService {
  constructor(private readonly client: RcClient) {}

  async types(): Promise<string[]> {
    const out = await this.client.call<{ mountTypes: string[] }>("mount/types");
    return out.mountTypes ?? [];
  }

  async mount(remote: string, path: string, mountPoint: string, mountType?: string): Promise<void> {
    const params: Record<string, unknown> = { fs: fsString(remote, path), mountPoint };
    if (mountType) params.mountType = mountType;
    await this.client.call("mount/mount", params);
  }

  async list(): Promise<MountInstance[]> {
    const out = await this.client.call<{ mountPoints?: Array<{ Fs?: string; MountPoint?: string }> }>("mount/listmounts");
    return (out.mountPoints ?? []).map((m) => ({ fs: m.Fs ?? "", mountPoint: m.MountPoint ?? "" }));
  }

  async unmount(mountPoint: string): Promise<void> {
    await this.client.call("mount/unmount", { mountPoint });
  }
}
