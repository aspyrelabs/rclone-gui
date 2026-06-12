import type { FastifyInstance } from "fastify";
import type { ScheduleService } from "../schedules/service.js";
import type { ScheduleInput } from "../schedules/store.js";

function validInput(b: Partial<ScheduleInput>): b is ScheduleInput {
  return Boolean(
    b && b.name && (b.type === "copy" || b.type === "move") &&
    typeof b.isDir === "boolean" && b.src?.remote && b.dst?.remote &&
    typeof b.cron === "string" && typeof b.enabled === "boolean",
  );
}

export function schedulesRoutes(service: ScheduleService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get("/api/schedules", async () => ({ schedules: service.list() }));

    app.post<{ Body: ScheduleInput }>("/api/schedules", async (req, reply) => {
      const b = req.body;
      if (!validInput(b)) return reply.code(400).send({ error: "invalid schedule", status: 400 });
      if (!service.isValidCron(b.cron)) return reply.code(400).send({ error: "invalid cron expression", status: 400 });
      return reply.code(201).send({ schedule: await service.create(b) });
    });

    app.put<{ Params: { id: string }; Body: Partial<ScheduleInput> }>("/api/schedules/:id", async (req, reply) => {
      const patch = req.body ?? {};
      if (patch.cron !== undefined && !service.isValidCron(patch.cron)) {
        return reply.code(400).send({ error: "invalid cron expression", status: 400 });
      }
      const s = await service.update(req.params.id, patch);
      if (!s) return reply.code(404).send({ error: "not found", status: 404 });
      return { schedule: s };
    });

    app.delete<{ Params: { id: string } }>("/api/schedules/:id", async (req, reply) => {
      const ok = await service.delete(req.params.id);
      if (!ok) return reply.code(404).send({ error: "not found", status: 404 });
      return { deleted: req.params.id };
    });

    app.post<{ Params: { id: string } }>("/api/schedules/:id/run", async (req, reply) => {
      await service.runNow(req.params.id);
      return reply.code(200).send({ ran: req.params.id });
    });
  };
}
