import type { FastifyInstance } from "fastify";
import type { BrowseService } from "../rclone/browse.js";

interface MkdirBody { remote: string; path: string; name: string; }
interface DeleteBody { remote: string; path: string; name: string; isDir: boolean; }

export function browseRoutes(browse: BrowseService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get<{ Querystring: { remote?: string; path?: string } }>("/api/browse", async (req, reply) => {
      const remote = req.query.remote;
      if (!remote) return reply.code(400).send({ error: "remote is required", status: 400 });
      const entries = await browse.list(remote, req.query.path ?? "");
      return { entries };
    });

    app.post<{ Body: MkdirBody }>("/api/browse/mkdir", async (req, reply) => {
      const { remote, path, name } = req.body ?? ({} as MkdirBody);
      if (!remote || !name) return reply.code(400).send({ error: "remote and name are required", status: 400 });
      await browse.mkdir(remote, path ?? "", name);
      return reply.code(201).send({ created: name });
    });

    app.post<{ Body: DeleteBody }>("/api/browse/delete", async (req, reply) => {
      const { remote, path, name, isDir } = req.body ?? ({} as DeleteBody);
      if (!remote || !name) return reply.code(400).send({ error: "remote and name are required", status: 400 });
      await browse.deletePath(remote, path ?? "", name, Boolean(isDir));
      return reply.code(200).send({ deleted: name });
    });
  };
}
