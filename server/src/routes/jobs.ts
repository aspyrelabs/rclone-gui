import type { FastifyInstance } from "fastify";
import type { JobService, LaunchInput } from "../rclone/jobs.js";

export function jobsRoutes(jobs: JobService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.post<{ Body: LaunchInput }>("/api/jobs", async (req, reply) => {
      const b = req.body;
      if (!b || !b.src?.remote || !b.dst?.remote) {
        return reply.code(400).send({ error: "src.remote and dst.remote are required", status: 400 });
      }
      if (!b.isDir && (!b.src?.name || !b.dst?.name)) {
        return reply.code(400).send({ error: "src.name and dst.name are required for file operations", status: 400 });
      }
      if (b.type !== "copy" && b.type !== "move") {
        return reply.code(400).send({ error: "type must be copy or move", status: 400 });
      }
      return jobs.launch(b);
    });

    app.get("/api/jobs", async () => ({ jobs: await jobs.list() }));

    app.post<{ Params: { id: string } }>("/api/jobs/:id/stop", async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid job id", status: 400 });
      await jobs.stop(id);
      return reply.code(200).send({ stopped: id });
    });
  };
}
