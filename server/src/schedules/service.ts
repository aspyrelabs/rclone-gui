import type { Cron } from "./cron.js";
import type { Scheduler } from "./scheduler.js";
import type { Schedule, ScheduleInput, ScheduleStore } from "./store.js";

export class ScheduleService {
  constructor(
    private readonly store: ScheduleStore,
    private readonly scheduler: Scheduler,
    private readonly cron: Cron,
  ) {}

  isValidCron(expr: string): boolean {
    return this.cron.validate(expr);
  }

  list(): Schedule[] {
    return this.store.list();
  }

  async create(input: ScheduleInput): Promise<Schedule> {
    if (!this.cron.validate(input.cron)) throw new Error("invalid cron expression");
    const s = await this.store.create(input);
    this.scheduler.reload();
    return s;
  }

  async update(id: string, patch: Partial<ScheduleInput>): Promise<Schedule | undefined> {
    if (patch.cron !== undefined && !this.cron.validate(patch.cron)) throw new Error("invalid cron expression");
    const s = await this.store.update(id, patch);
    this.scheduler.reload();
    return s;
  }

  async delete(id: string): Promise<boolean> {
    const ok = await this.store.delete(id);
    this.scheduler.reload();
    return ok;
  }

  async runNow(id: string): Promise<void> {
    await this.scheduler.fire(id);
  }
}
