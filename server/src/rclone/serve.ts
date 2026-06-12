import type { RcClient } from "./client.js";
import { fsString } from "./browse.js";

export interface ServeInstance {
  id: string;
  addr: string;
  type: string;
  fs: string;
}

export class ServeService {
  constructor(private readonly client: RcClient) {}

  async types(): Promise<string[]> {
    const out = await this.client.call<{ types: string[] }>("serve/types");
    return out.types ?? [];
  }

  async start(
    type: string,
    remote: string,
    path: string,
    addr?: string,
    opt?: Record<string, unknown>,
  ): Promise<{ id: string; addr: string }> {
    const params: Record<string, unknown> = { type, fs: fsString(remote, path) };
    if (addr) params.addr = addr;
    if (opt) params.opt = opt;
    return this.client.call<{ id: string; addr: string }>("serve/start", params);
  }

  async list(): Promise<ServeInstance[]> {
    const out = await this.client.call<{
      list?: Array<{ id: string; addr: string; params?: { type?: string; fs?: string } }>;
    }>("serve/list");
    return (out.list ?? []).map((s) => ({
      id: s.id,
      addr: s.addr,
      type: s.params?.type ?? "",
      fs: s.params?.fs ?? "",
    }));
  }

  async stop(id: string): Promise<void> {
    await this.client.call("serve/stop", { id });
  }
}
