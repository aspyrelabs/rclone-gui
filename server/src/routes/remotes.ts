import type { FastifyInstance } from "fastify";
import type { RemoteService } from "../rclone/remotes.js";

interface CreateBody {
  name: string;
  type: string;
  parameters?: Record<string, string>;
}
interface UpdateBody {
  parameters: Record<string, string>;
}
interface ContinueBody {
  state: string;
  result: string;
}

const NAME_RE = /^[\w.+@-]+$/; // rclone-legal remote names

export function remotesRoutes(remotes: RemoteService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/remotes", async () => ({ remotes: await remotes.list() }));

    app.post<{ Body: CreateBody }>("/api/remotes", async (req, reply) => {
      const { name, type, parameters = {} } = req.body ?? ({} as CreateBody);
      if (!name || !NAME_RE.test(name)) return reply.code(400).send({ error: "invalid remote name" });
      if (!type) return reply.code(400).send({ error: "type is required" });
      const configOut = await remotes.create(name, type, parameters);
      // Empty/no State => done; otherwise an interactive step (e.g. OAuth) is pending.
      if (configOut && configOut.State) return reply.code(200).send({ pending: configOut });
      return reply.code(201).send({ created: name });
    });

    app.post<{ Params: { name: string }; Body: ContinueBody }>(
      "/api/remotes/:name/continue",
      async (req, reply) => {
        const { name } = req.params;
        const { state, result } = req.body ?? ({} as ContinueBody);
        const configOut = await remotes.continueConfig(name, state, result);
        if (configOut && configOut.State) return reply.code(200).send({ pending: configOut });
        return reply.code(200).send({ created: name });
      },
    );

    app.put<{ Params: { name: string }; Body: UpdateBody }>(
      "/api/remotes/:name",
      async (req, reply) => {
        await remotes.update(req.params.name, req.body?.parameters ?? {});
        return reply.code(200).send({ updated: req.params.name });
      },
    );

    app.delete<{ Params: { name: string } }>("/api/remotes/:name", async (req, reply) => {
      await remotes.delete(req.params.name);
      return reply.code(200).send({ deleted: req.params.name });
    });

    app.post<{ Params: { name: string } }>("/api/remotes/:name/test", async (req) => {
      return remotes.test(req.params.name);
    });
  };
}
