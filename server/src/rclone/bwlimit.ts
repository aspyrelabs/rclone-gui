import type { RcClient } from "./client.js";

export interface BwLimit {
  rate: string;
  bytesPerSecond: number;
  bytesPerSecondRx: number;
  bytesPerSecondTx: number;
}

export class BwLimitService {
  constructor(private readonly client: RcClient) {}

  get(): Promise<BwLimit> {
    return this.client.call<BwLimit>("core/bwlimit");
  }

  set(rate: string): Promise<BwLimit> {
    return this.client.call<BwLimit>("core/bwlimit", { rate });
  }
}
