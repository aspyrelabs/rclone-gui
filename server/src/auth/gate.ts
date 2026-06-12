import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const COOKIE = "rg_session";

function sign(secret: string): string {
  return createHmac("sha256", secret).update("authenticated").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface AuthGate {
  password: string | null;
  register(app: FastifyInstance): Promise<void>;
}

export function createAuthGate(password: string | null): AuthGate {
  const secret = randomBytes(32).toString("hex");
  const token = sign(secret);

  return {
    password,
    async register(app: FastifyInstance): Promise<void> {
      // Status endpoint: tells the UI whether auth is on and whether this session is in.
      app.get("/api/auth/status", async (req: FastifyRequest) => {
        const authed = !password || req.cookies[COOKIE] === token;
        return { protected: Boolean(password), authenticated: authed };
      });

      app.post<{ Body: { password?: string } }>("/api/auth/login", async (req, reply) => {
        if (!password) return reply.code(200).send({ authenticated: true });
        const supplied = req.body?.password ?? "";
        if (safeEqual(supplied, password)) {
          reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
          return reply.code(200).send({ authenticated: true });
        }
        return reply.code(401).send({ error: "invalid password" });
      });

      if (!password) return; // open mode: no guard installed

      app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
        const url = req.url.split("?")[0];
        if (
          url === "/api/health" ||
          url === "/api/auth/status" ||
          url === "/api/auth/login" ||
          !url.startsWith("/api/")
        ) {
          return; // public routes + static assets
        }
        if (req.cookies[COOKIE] !== token) {
          return reply.code(401).send({ error: "authentication required" });
        }
      });
    },
  };
}
