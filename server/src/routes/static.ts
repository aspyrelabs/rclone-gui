import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Serve the built SPA from `webRoot`, with a history-API fallback: any GET that
 * isn't an /api route and didn't match a static file returns index.html so
 * client-side routes work on reload.
 */
export function staticRoutes(webRoot: string) {
  return async function (app: FastifyInstance): Promise<void> {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });

    const indexPath = path.join(webRoot, "index.html");
    app.setNotFoundHandler(async (req, reply) => {
      const url = req.url.split("?")[0];
      // Only navigation requests (no file extension) fall back to the SPA shell.
      // A missing asset (e.g. a stale hashed /assets/*.js) must return a real 404 —
      // never index.html, or the browser would try to execute HTML as a module.
      const lastSegment = url.slice(url.lastIndexOf("/") + 1);
      const looksLikeFile = lastSegment.includes(".");
      if (req.method === "GET" && !url.startsWith("/api/") && !looksLikeFile && existsSync(indexPath)) {
        const html = await readFile(indexPath, "utf8");
        return reply.type("text/html").send(html);
      }
      return reply.code(404).send({ error: "not found", status: 404 });
    });
  };
}
