import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

export interface DaemonEndpoint {
  url: string; // e.g. http://127.0.0.1:5572
  user: string;
  pass: string;
}

export interface RcloneDaemonOptions {
  binary: string | (() => string);
  configPath: string;
  extraArgs?: string[];
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not get port")));
      }
    });
  });
}

const MAX_RESTART_ATTEMPTS = 5;

export class RcloneDaemon {
  private child: ChildProcess | null = null;
  private endpoint: DaemonEndpoint | null = null;
  private stopping = false;
  private restartAttempts = 0;

  constructor(private readonly opts: RcloneDaemonOptions) {}

  getEndpoint(): DaemonEndpoint {
    if (!this.endpoint) throw new Error("daemon not started");
    return this.endpoint;
  }

  async start(): Promise<DaemonEndpoint> {
    // Fix #2: reset stopping flag so auto-restart works after a previous stop()
    this.stopping = false;

    const port = await getFreePort();
    const user = "gui";
    const pass = randomBytes(24).toString("hex");
    const url = `http://127.0.0.1:${port}`;

    const binary = typeof this.opts.binary === "function" ? this.opts.binary() : this.opts.binary;

    const args = [
      "rcd",
      "--rc-addr", `127.0.0.1:${port}`,
      "--rc-user", user,
      "--rc-pass", pass,
      "--config", this.opts.configPath,
      ...(this.opts.extraArgs ?? []),
    ];

    this.child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });

    // Fix #5: drain stdout/stderr so a full pipe buffer cannot deadlock the child
    this.child.stdout?.resume();
    this.child.stderr?.resume();

    // Fix #4: race waitReady against a spawn error so we fail fast on bad binary path
    let onSpawnError!: (err: Error) => void;
    const spawnErrorPromise = new Promise<never>((_resolve, reject) => {
      onSpawnError = (err: Error) => reject(err);
      this.child!.once("error", onSpawnError);
    });

    // Fix #1: store the SIGKILL timer and clear it on clean exit
    // Fix #3: exponential back-off on auto-restart
    this.child.once("exit", (code) => {
      this.child = null;
      if (!this.stopping) {
        if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
          // Give up after too many consecutive failures
          return;
        }
        const delay = Math.min(2 ** this.restartAttempts * 200, 30_000);
        this.restartAttempts += 1;
        setTimeout(() => {
          this.start().catch(() => undefined);
        }, delay);
      } else {
        void code;
      }
    });

    this.endpoint = { url, user, pass };

    // Await readiness, but fail immediately if spawn itself errors.
    // Remove the rejecting listener once the race settles so a later "error"
    // event on the child does not cause an unhandled rejection.
    try {
      await Promise.race([this.waitReady(url, user, pass), spawnErrorPromise]);
    } finally {
      this.child?.removeListener("error", onSpawnError);
    }

    // Fix #3: reset restart counter on successful start
    this.restartAttempts = 0;

    return this.endpoint;
  }

  private authHeader(user: string, pass: string): string {
    return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }

  private async waitReady(url: string, user: string, pass: string): Promise<void> {
    const deadline = Date.now() + 15_000;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${url}/rc/noop`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: this.authHeader(user, pass) },
          body: "{}",
        });
        if (res.ok) return;
        lastErr = new Error(`rcd not ready: HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`rcd failed to become ready: ${String(lastErr)}`);
  }

  /** Stop and start the daemon (used after the binary is updated). */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      // Fix #1: use once() and clear the SIGKILL timer when the process exits cleanly
      let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
      child.once("exit", () => {
        clearTimeout(sigkillTimer);
        resolve();
      });
      child.kill("SIGTERM");
      sigkillTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
    });
    this.child = null;
    this.endpoint = null;
  }
}
