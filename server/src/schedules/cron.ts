import cron from "node-cron";

export interface CronTask {
  stop(): void;
}

export interface Cron {
  validate(expr: string): boolean;
  schedule(expr: string, fn: () => void): CronTask;
}

export const nodeCron: Cron = {
  validate: (expr) => cron.validate(expr),
  schedule: (expr, fn) => {
    const task = cron.schedule(expr, fn);
    return { stop: () => task.stop() };
  },
};
