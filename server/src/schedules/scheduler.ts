import type { JobService } from "../rclone/jobs.js";
import type { Cron, CronTask } from "./cron.js";
import type { ScheduleStore } from "./store.js";

export class Scheduler {
  private tasks = new Map<string, CronTask>();

  constructor(
    private readonly store: ScheduleStore,
    private readonly jobs: JobService,
    private readonly cron: Cron,
  ) {}

  reload(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
    for (const s of this.store.list()) {
      if (s.enabled && this.cron.validate(s.cron)) {
        this.tasks.set(s.id, this.cron.schedule(s.cron, () => { this.fire(s.id).catch(() => {}); }));
      }
    }
  }

  async fire(id: string): Promise<void> {
    const s = this.store.get(id);
    if (!s) return;
    try {
      const { jobid } = await this.jobs.launch({ type: s.type, isDir: s.isDir, src: s.src, dst: s.dst });
      await this.store.recordRun(id, { lastJobId: jobid, lastError: undefined });
    } catch (e) {
      try {
        await this.store.recordRun(id, { lastError: (e as Error).message });
      } catch {
        // recording failed (e.g. disk error); nothing more we can do
      }
    }
  }
}
