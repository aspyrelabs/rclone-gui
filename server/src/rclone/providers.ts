import type { RcClient } from "./client.js";
import type { RcProvider } from "./types.js";

export class ProvidersService {
  private cache: RcProvider[] | null = null;

  constructor(private readonly client: RcClient) {}

  async list(): Promise<RcProvider[]> {
    if (this.cache) return this.cache;
    const out = await this.client.call<{ providers: RcProvider[] }>("config/providers");
    this.cache = out.providers.filter((p) => !p.Hide);
    return this.cache;
  }

  /** Drop the cache (call after an rclone binary update). */
  invalidate(): void {
    this.cache = null;
  }
}
