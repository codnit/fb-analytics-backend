import { Request, Response, NextFunction } from "express";
import { EventEmitter } from "events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InboundLog {
  id: string;
  type: "inbound";
  timestamp: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  requestBodySize: number;
  responseBodySize: number;
  ip: string;
  userAgent: string;
  error?: string;
  responseBody?: string;
}

export interface OutboundLog {
  id: string;
  type: "outbound";
  timestamp: string;
  service: string; // e.g. "Facebook Graph API", "Supabase", etc.
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  error?: string;
  responseBody?: string;
}

export type ApiLog = InboundLog | OutboundLog;

// ─── In-Memory Store (ring buffer) ────────────────────────────────────────────

const MAX_LOGS = 500;

class TelemetryStore extends EventEmitter {
  private logs: ApiLog[] = [];
  private stats = {
    totalRequests: 0,
    totalErrors: 0,
    totalOutbound: 0,
    avgDurationMs: 0,
    _durationSum: 0,
  };

  add(log: ApiLog) {
    this.logs.unshift(log); // newest first
    if (this.logs.length > MAX_LOGS) this.logs.pop();

    if (log.type === "inbound") {
      this.stats.totalRequests++;
      if (log.statusCode >= 400) this.stats.totalErrors++;
      this.stats._durationSum += log.durationMs;
      this.stats.avgDurationMs = Math.round(this.stats._durationSum / this.stats.totalRequests);
    } else {
      this.stats.totalOutbound++;
    }

    this.emit("log", log);
    this.emit("stats", this.getStats());
  }

  getLogs(limit = 100): ApiLog[] {
    return this.logs.slice(0, limit);
  }

  getStats() {
    const recentInbound = this.logs.filter((l): l is InboundLog => l.type === "inbound").slice(0, 50);
    const errorRate =
      recentInbound.length > 0
        ? Math.round((recentInbound.filter((l) => l.statusCode >= 400).length / recentInbound.length) * 100)
        : 0;

    // Count by route
    const routeCounts: Record<string, number> = {};
    recentInbound.forEach((l) => {
      routeCounts[`${l.method} ${l.route}`] = (routeCounts[`${l.method} ${l.route}`] || 0) + 1;
    });

    // Count by service (outbound)
    const serviceCounts: Record<string, number> = {};
    this.logs
      .filter((l): l is OutboundLog => l.type === "outbound")
      .slice(0, 50)
      .forEach((l) => {
        serviceCounts[l.service] = (serviceCounts[l.service] || 0) + 1;
      });

    return {
      totalRequests: this.stats.totalRequests,
      totalErrors: this.stats.totalErrors,
      totalOutbound: this.stats.totalOutbound,
      avgDurationMs: this.stats.avgDurationMs,
      errorRate,
      routeCounts,
      serviceCounts,
    };
  }

  clear() {
    this.logs = [];
    this.stats = { totalRequests: 0, totalErrors: 0, totalOutbound: 0, avgDurationMs: 0, _durationSum: 0 };
    this.emit("stats", this.getStats());
  }
}

export const telemetryStore = new TelemetryStore();
telemetryStore.setMaxListeners(50);

// ─── Inbound Middleware ───────────────────────────────────────────────────────

let _idCounter = 0;
function makeId() {
  return `${Date.now()}-${_idCounter++}`;
}

export function apiTelemetryMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const requestBodySize = JSON.stringify(req.body || {}).length;

  // Capture response body via write/end override (limit to 50KB to avoid lag)
  let responseBodySize = 0;
  let responseBodyChunks: Buffer[] = [];
  const MAX_BODY_STORE = 50 * 1024; // 50KB

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  const captureSize = (chunk: unknown) => {
    if (!chunk) return;
    
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    responseBodySize += buffer.length;
    
    if (responseBodyChunks.reduce((acc, c) => acc + c.length, 0) < MAX_BODY_STORE) {
        responseBodyChunks.push(buffer);
    }
  };

  // @ts-ignore
  res.write = function (chunk, ...args) {
    captureSize(chunk);
    return originalWrite(chunk, ...args);
  };

  // @ts-ignore
  res.end = function (chunk, ...args) {
    captureSize(chunk);
    const durationMs = Date.now() - start;

    // Skip the monitor dashboard itself
    if (!req.originalUrl.startsWith("/_monitor")) {
      const log: InboundLog = {
        id: makeId(),
        type: "inbound",
        timestamp: new Date().toISOString(),
        method: req.method,
        route: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
        requestBodySize,
        responseBodySize,
        ip: String(req.ip || req.socket?.remoteAddress || "unknown"),
        userAgent: String(req.headers["user-agent"] || "unknown"),
      };

      // Try to parse the body if it's small enough and looks like JSON or text
      if (responseBodyChunks.length > 0) {
        try {
            const bodyStr = Buffer.concat(responseBodyChunks).toString("utf-8", 0, MAX_BODY_STORE);
            log.responseBody = bodyStr;
        } catch(e) {
            log.responseBody = "[Binary or unparseable data]";
        }
      }

      telemetryStore.add(log);
    }

    return originalEnd(chunk, ...args);
  };

  next();
}

// ─── Outbound Logger (call this from axios interceptors) ──────────────────────

export function logOutboundCall(entry: Omit<OutboundLog, "id" | "type">) {
  const log: OutboundLog = {
    id: makeId(),
    type: "outbound",
    ...entry,
  };
  telemetryStore.add(log);
}
