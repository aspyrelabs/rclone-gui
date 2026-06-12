import type { FastifyInstance } from "fastify";
import type { MountService } from "../rclone/mounts.js";

interface MountBody { remote: string; path?: string; mountPoint: string; mountType?: string; }
interface UnmountBody { mountPoint: string; }

export function mountsRoutes(mounts: MountService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/mounts/types", async () => ({ types: await mounts.types() }));
    app.get("/api/mounts", async () => ({ mounts: await mounts.list() }));

    app.post<{ Body: MountBody }>("/api/mounts", async (req, reply) => {
      const b = req.body ?? ({} as MountBody);
      if (!b.remote || !b.mountPoint) return reply.code(400).send({ error: "remote and mountPoint are required", status: 400 });
      await mounts.mount(b.remote, b.path ?? "", b.mountPoint, b.mountType);
      return reply.code(201).send({ mounted: b.mountPoint });
    });

    app.post<{ Body: UnmountBody }>("/api/mounts/unmount", async (req, reply) => {
      const b = req.body ?? ({} as UnmountBody);
      if (!b.mountPoint) return reply.code(400).send({ error: "mountPoint is required", status: 400 });
      await mounts.unmount(b.mountPoint);
      return reply.code(200).send({ unmounted: b.mountPoint });
    });
  };
}
