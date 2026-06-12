import type { DaemonEndpoint } from "./daemon.js";

export class RcError extends Error {
  constructor(message: string, readonly status: number, readonly path: string) {
    super(message);
    this.name = "RcError";
  }
}

export interface EndpointProvider {
  getEndpoint(): DaemonEndpoint;
}

export class RcClient {
  constructor(private readonly endpoints: EndpointProvider) {}

  async call<T = Record<string, unknown>>(rcPath: string, params: Record<string, unknown> = {}): Promise<T> {
    const ep = this.endpoints.getEndpoint();
    const res = await fetch(`${ep.url}/${rcPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Basic " + Buffer.from(`${ep.user}:${ep.pass}`).toString("base64"),
      },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text.length ? JSON.parse(text) : {};
    } catch {
      throw new RcError(`invalid JSON from rclone: ${text.slice(0, 200)}`, res.status, rcPath);
    }
    if (!res.ok) {
      const errMsg =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `rc call failed: HTTP ${res.status}`;
      throw new RcError(errMsg, res.status, rcPath);
    }
    return body as T;
  }
}
