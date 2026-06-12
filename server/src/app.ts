import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { healthRoutes } from "./routes/health.js";
import { providersRoutes } from "./routes/providers.js";
import { remotesRoutes } from "./routes/remotes.js";
import { staticRoutes } from "./routes/static.js";
import { versionRoutes } from "./routes/version.js";
import { browseRoutes } from "./routes/browse.js";
import { jobsRoutes } from "./routes/jobs.js";
import { serveRoutes } from "./routes/serve.js";
import { mountsRoutes } from "./routes/mounts.js";
import { schedulesRoutes } from "./routes/schedules.js";
import { bwlimitRoutes } from "./routes/bwlimit.js";
import { createAuthGate } from "./auth/gate.js";
import type { ProvidersService } from "./rclone/providers.js";
import type { RemoteService } from "./rclone/remotes.js";
import type { VersionService } from "./rclone/version.js";
import type { BrowseService } from "./rclone/browse.js";
import type { JobService } from "./rclone/jobs.js";
import type { ServeService } from "./rclone/serve.js";
import type { MountService } from "./rclone/mounts.js";
import type { ScheduleService } from "./schedules/service.js";
import type { BwLimitService } from "./rclone/bwlimit.js";
import { RcError } from "./rclone/client.js";

export interface BuildAppDeps {
  providers?: ProvidersService;
  remotes?: RemoteService;
  version?: VersionService;
  browse?: BrowseService;
  jobs?: JobService;
  serve?: ServeService;
  mounts?: MountService;
  schedules?: ScheduleService;
  bwlimit?: BwLimitService;
  guiPassword?: string | null;
  webRoot?: string | null;
}

export async function buildApp(deps: BuildAppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof RcError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return reply.code(status).send({ error: err.message, status });
    }
    return reply.code(500).send({ error: err.message ?? "internal error", status: 500 });
  });

  await createAuthGate(deps.guiPassword ?? null).register(app);
  await app.register(healthRoutes);
  if (deps.providers) await app.register(providersRoutes(deps.providers));
  if (deps.remotes) await app.register(remotesRoutes(deps.remotes));
  if (deps.version) await app.register(versionRoutes(deps.version));
  if (deps.browse) await app.register(browseRoutes(deps.browse));
  if (deps.jobs) await app.register(jobsRoutes(deps.jobs));
  if (deps.serve) await app.register(serveRoutes(deps.serve));
  if (deps.mounts) await app.register(mountsRoutes(deps.mounts));
  if (deps.schedules) await app.register(schedulesRoutes(deps.schedules));
  if (deps.bwlimit) await app.register(bwlimitRoutes(deps.bwlimit));
  if (deps.webRoot) await app.register(staticRoutes(deps.webRoot));
  return app;
}
