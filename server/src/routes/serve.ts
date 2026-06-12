import type { FastifyInstance } from "fastify";
import type { ServeService } from "../rclone/serve.js";

interface StartBody {
  type: string;
  remote: string;
  path?: string;
  addr?: string;
  opt?: Record<string, unknown>;
}

export function serveRoutes(serve: ServeService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/serve/types", async () => ({ types: await serve.types() }));
    app.get("/api/serve", async () => ({ serves: await serve.list() }));

    app.post<{ Body: StartBody }>("/api/serve", async (req, reply) => {
      const b = req.body ?? ({} as StartBody);
      if (!b.type || !b.remote) return reply.code(400).send({ error: "type and remote are required", status: 400 });
      return serve.start(b.type, b.remote, b.path ?? "", b.addr, b.opt);
    });

    app.post<{ Params: { id: string } }>("/api/serve/:id/stop", async (req, reply) => {
      if (!req.params.id) return reply.code(400).send({ error: "id is required", status: 400 });
      await serve.stop(req.params.id);
      return reply.code(200).send({ stopped: req.params.id });
    });
  };
}
