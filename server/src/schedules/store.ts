import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface SchedulePathRef {
  remote: string;
  path: string;
  name: string;
}

export interface RunRecord {
  time: string;
  jobId?: number;
  error?: string;
}

export interface Schedule {
  id: string;
  name: string;
  type: "copy" | "move";
  isDir: boolean;
  src: SchedulePathRef;
  dst: SchedulePathRef;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  lastJobId?: number;
  lastError?: string;
  history: RunRecord[];
}

export type ScheduleInput = Omit<Schedule, "id" | "lastRun" | "lastJobId" | "lastError" | "history">;

export interface ScheduleStoreOpts {
  filePath: string;
  now?: () => string;
}

export class ScheduleStore {
  private schedules: Schedule[] = [];
  private readonly now: () => string;

  constructor(private readonly opts: ScheduleStoreOpts) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.opts.filePath, "utf8");
      const parsed: unknown = text.trim() ? JSON.parse(text) : [];
      const arr = Array.isArray(parsed) ? (parsed as Schedule[]) : [];
      this.schedules = arr.map((s) => ({ ...s, history: s.history ?? [] }));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.schedules = [];
      } else {
        throw e;
      }
    }
  }

  list(): Schedule[] {
    return this.schedules.map((s) => ({ ...s }));
  }

  get(id: string): Schedule | undefined {
    const s = this.schedules.find((x) => x.id === id);
    return s ? { ...s } : undefined;
  }

  async create(input: ScheduleInput): Promise<Schedule> {
    const s: Schedule = { ...input, id: randomUUID(), history: [] };
    this.schedules.push(s);
    await this.save();
    return { ...s };
  }

  async update(id: string, patch: Partial<ScheduleInput>): Promise<Schedule | undefined> {
    const s = this.schedules.find((x) => x.id === id);
    if (!s) return undefined;
    Object.assign(s, patch);
    await this.save();
    return { ...s };
  }

  async delete(id: string): Promise<boolean> {
    const before = this.schedules.length;
    this.schedules = this.schedules.filter((x) => x.id !== id);
    if (this.schedules.length === before) return false;
    await this.save();
    return true;
  }

  async recordRun(id: string, fields: { lastJobId?: number; lastError?: string }): Promise<void> {
    const s = this.schedules.find((x) => x.id === id);
    if (!s) return;
    s.lastRun = this.now();
    if (fields.lastJobId !== undefined) s.lastJobId = fields.lastJobId;
    s.lastError = fields.lastError;
    const record: RunRecord = { time: s.lastRun, jobId: fields.lastJobId, error: fields.lastError };
    s.history = [record, ...(s.history ?? [])].slice(0, 20);
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.opts.filePath), { recursive: true });
    const tmp = `${this.opts.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.schedules, null, 2), "utf8");
    await rename(tmp, this.opts.filePath);
  }
}
