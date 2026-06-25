import { Router, Request, Response } from "express";
import { telemetryStore } from "../middleware/apiTelemetry";

const router = Router();

/** GET /_monitor/logs?limit=100 — last N log entries */
router.get("/logs", (_req: Request, res: Response) => {
  const limit = Math.min(Number(_req.query.limit) || 100, 500);
  res.json({ logs: telemetryStore.getLogs(limit) });
});

/** GET /_monitor/stats — aggregate stats */
router.get("/stats", (_req: Request, res: Response) => {
  res.json(telemetryStore.getStats());
});

/** DELETE /_monitor/clear — wipe all logs */
router.delete("/clear", (_req: Request, res: Response) => {
  telemetryStore.clear();
  res.json({ ok: true });
});

export default router;
