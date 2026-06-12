import type { FastifyInstance } from "fastify";
import type { VersionService } from "../rclone/version.js";

export function versionRoutes(version: VersionService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/version", async () => version.status());
    app.post<{ Body: { version?: string } }>("/api/version/update", async (req) => {
      return version.update(req.body?.version);
    });
  };
}
