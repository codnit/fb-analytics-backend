import type { NextFunction, Request, Response } from "express";
import { BaseController } from "../core/base.controller";
import notificationService from "../services/notifications/notification.service";
import { notificationEventBus } from "../services/notifications/notification.events";

const getPartnerId = (req: Request): string => String((req as any).partnerId || "");

export class NotificationController extends BaseController {
  list = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const limit = Number.parseInt(String(req.query.limit || "20"), 10);
      const notifications = await notificationService.listForPartner(getPartnerId(req), Number.isNaN(limit) ? 20 : limit);
      return this.ok(res, notifications, "Notifications retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  markRead = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const updated = await notificationService.markRead(req.params.notificationId, getPartnerId(req));
      if (!updated) return this.notFound(res, "Notification not found");
      return this.ok(res, { updated: true }, "Notification marked as read");
    } catch (error) {
      return next(error);
    }
  };

  markAllRead = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const updatedCount = await notificationService.markAllRead(getPartnerId(req));
      return this.ok(res, { updatedCount }, "Notifications marked as read");
    } catch (error) {
      return next(error);
    }
  };

  stream = async (req: Request, res: Response): Promise<void> => {
    const partnerId = getPartnerId(req);

    try {
      await notificationEventBus.connect();
    } catch (error) {
      console.error("[notifications] SSE Redis connection unavailable:", error);
    }

    (res as any).status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    (res as any).flushHeaders();

    const writeEvent = (event: string, payload: unknown): void => {
      if (!(res as any).writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      }
    };

    writeEvent("connected", { connected: true });
    const unsubscribe = notificationEventBus.subscribe(partnerId, (payload) => writeEvent("notification.created", payload));
    const keepAlive = setInterval(() => {
      if (!(res as any).writableEnded) res.write(": keep-alive\n\n");
    }, 25000);

    const cleanup = (): void => {
      clearInterval(keepAlive);
      unsubscribe();
    };

    (req as any).on("close", cleanup);
  };
}

export default new NotificationController();
