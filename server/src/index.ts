import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { resolveRcloneBinary } from "./rclone/resolveBinary.js";
import { RcloneDaemon } from "./rclone/daemon.js";
import { RcClient } from "./rclone/client.js";
import { ProvidersService } from "./rclone/providers.js";
import { RemoteService } from "./rclone/remotes.js";
import { VersionService, fetchLatestFromGitHub, makeScriptInstaller } from "./rclone/version.js";
import { BrowseService } from "./rclone/browse.js";
import { JobService } from "./rclone/jobs.js";
import { ScheduleStore } from "./schedules/store.js";
import { Scheduler } from "./schedules/scheduler.js";
import { ScheduleService } from "./schedules/service.js";
import { nodeCron } from "./schedules/cron.js";
import { ServeService } from "./rclone/serve.js";
import { MountService } from "./rclone/mounts.js";
import { BwLimitService } from "./rclone/bwlimit.js";
import { getRcloneVersion } from "./rclone/resolveBinary.js";
import { buildApp } from "./app.js";

export async function main(): Promise<void> {
  const cfg = loadConfig();
  await mkdir(path.dirname(cfg.rcloneConfigPath), { recursive: true });

  const resolveBin = () => resolveRcloneBinary({ override: cfg.rcloneBinary, configDir: cfg.configDir });
  const daemon = new RcloneDaemon({ binary: resolveBin, configPath: cfg.rcloneConfigPath });
  await daemon.start();

  const client = new RcClient(daemon);
  const bwlimit = new BwLimitService(client);
  const mounts = new MountService(client);
  const serve = new ServeService(client);
  const jobs = new JobService(client);
  const scheduleStore = new ScheduleStore({ filePath: cfg.schedulesPath });
  await scheduleStore.load();
  const scheduler = new Scheduler(scheduleStore, jobs, nodeCron);
  const schedules = new ScheduleService(scheduleStore, scheduler, nodeCron);
  scheduler.reload(); // register tasks for enabled schedules loaded from disk
  const browse = new BrowseService(client);
  const providers = new ProvidersService(client);
  const version = new VersionService({
    getInstalled: () => getRcloneVersion(resolveBin()),
    fetchLatest: fetchLatestFromGitHub,
    install: makeScriptInstaller(cfg.fetchScriptPath, cfg.configDir),
    afterInstall: async () => {
      await daemon.restart();
      providers.invalidate();
    },
  });
  const app = await buildApp({
    providers,
    remotes: new RemoteService(client),
    version,
    browse,
    jobs,
    serve,
    mounts,
    schedules,
    bwlimit,
    guiPassword: cfg.guiPassword,
    webRoot: cfg.webRoot,
  });

  const shutdown = async () => {
    await app.close();
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: cfg.port, host: cfg.host });
  // eslint-disable-next-line no-console
  console.log(`rclone-gui listening on http://${cfg.host}:${cfg.port}`);
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
