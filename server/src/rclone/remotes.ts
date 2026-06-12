import type { RcClient } from "./client.js";
import type { ConfigOut, RemoteSummary } from "./types.js";

export class RemoteService {
  constructor(private readonly client: RcClient) {}

  async list(): Promise<RemoteSummary[]> {
    const { remotes } = await this.client.call<{ remotes: string[] }>("config/listremotes");
    const dump = await this.client.call<Record<string, Record<string, string>>>("config/dump");
    return remotes.map((name) => {
      const params = dump[name] ?? {};
      const { type = "unknown", ...rest } = params;
      return { name, type, parameters: rest };
    });
  }

  async create(
    name: string,
    type: string,
    parameters: Record<string, string>,
  ): Promise<ConfigOut | null> {
    return this.client.call<ConfigOut | null>("config/create", {
      name,
      type,
      parameters,
      opt: { obscure: true, nonInteractive: true },
    });
  }

  async continueConfig(
    name: string,
    state: string,
    result: string,
  ): Promise<ConfigOut | null> {
    return this.client.call<ConfigOut | null>("config/create", {
      name,
      parameters: {},
      opt: { obscure: true, nonInteractive: true, continue: true, state, result },
    });
  }

  async update(name: string, parameters: Record<string, string>): Promise<void> {
    await this.client.call("config/update", {
      name,
      parameters,
      opt: { obscure: true, nonInteractive: true },
    });
  }

  async delete(name: string): Promise<void> {
    await this.client.call("config/delete", { name });
  }

  /** Lightweight connectivity check: try about, fall back to listing the root. */
  async test(name: string): Promise<{ ok: boolean; detail?: string }> {
    const fs = `${name}:`;
    try {
      await this.client.call("operations/about", { fs });
      return { ok: true };
    } catch (aboutErr) {
      try {
        await this.client.call("operations/list", { fs, remote: "", opt: { recurse: false } });
        return { ok: true };
      } catch (listErr) {
        return { ok: false, detail: (listErr as Error).message || (aboutErr as Error).message };
      }
    }
  }
}
