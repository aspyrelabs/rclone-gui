import type { FastifyInstance } from "fastify";
import type { ProvidersService } from "../rclone/providers.js";

export function providersRoutes(providers: ProvidersService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/providers", async () => ({ providers: await providers.list() }));
  };
}
