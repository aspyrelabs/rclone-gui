import type { FastifyInstance } from "fastify";
import type { BwLimitService } from "../rclone/bwlimit.js";

export function bwlimitRoutes(bwlimit: BwLimitService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/bwlimit", async () => bwlimit.get());
    app.post<{ Body: { rate?: string } }>("/api/bwlimit", async (req, reply) => {
      const rate = req.body?.rate;
      if (!rate) return reply.code(400).send({ error: "rate is required", status: 400 });
      return bwlimit.set(rate);
    });
  };
}
