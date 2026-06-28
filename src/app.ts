import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { Environment } from "./config/environment";
import insightsRoutes from "./routes/insights.routes";
import partnerRoutes from "./routes/partner.routes";
import pageRoutes from "./routes/page.routes";
import postRoutes from "./routes/post.routes";
import pageInsightsRoutes from "./routes/page_insights.routes";
import postInsightsRoutes from "./routes/post_insights.routes";
import revenueExportRoutes from "./routes/revenueExport.routes";
import saveFacebookDataRoutes from "./routes/saveFacebookData.routes";
import queueRoutes from "./routes/queue.routes";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import auth from "./middleware/auth";
import apiKeyAuth from "./middleware/apiKeyAuth";
import { apiTelemetryMiddleware } from "./middleware/apiTelemetry";
import monitorRoutes from "./routes/monitor.routes";

const app = express();
const corsOrigin = Environment.corsOrigin === "*" ? true : Environment.corsOrigin;

app.set("trust proxy", 1);
app.set("etag", false);

app.use(helmet());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// ── API Monitor (dashboard + REST telemetry endpoints) ─────────────
// Override helmet's strict CSP for the dashboard page only — allows inline
// scripts/styles that power the live UI without weakening the API routes.
app.get("/_monitor", (_req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self'; img-src 'self' data:"
  );
  res.sendFile(path.join(__dirname, "monitor", "dashboard.html"));
});
app.use("/_monitor", monitorRoutes);

// ── Telemetry middleware (must be before all API routes) ────────────
app.use(apiTelemetryMiddleware);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date(),
    environment: Environment.nodeEnv,
  });
});

app.use(`${Environment.apiPrefix}/insights`, insightsRoutes);
app.use(`${Environment.apiPrefix}/page-insights`, pageInsightsRoutes);
app.use(`${Environment.apiPrefix}/post-insights`, postInsightsRoutes);
app.use(`${Environment.apiPrefix}/partners`, partnerRoutes);
app.use(`${Environment.apiPrefix}/pages`, pageRoutes);
app.use(`${Environment.apiPrefix}/posts`, postRoutes);
app.use(`${Environment.apiPrefix}/facebook/connect`, saveFacebookDataRoutes);
app.use(`${Environment.apiPrefix}/revenue-export`, apiKeyAuth, revenueExportRoutes);
app.use(`${Environment.apiPrefix}/queues`, queueRoutes);
app.use(`${Environment.apiPrefix}/admin`, adminRoutes);
app.use(`${Environment.apiPrefix}/auth`, authRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

app.use((err: Error & { status?: number; statusCode?: number }, _req, res, _next) => {
  console.error(err.stack);

  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(status).json({
    success: false,
    message,
    ...(Environment.nodeEnv === "development" && { error: err.stack }),
  });
});

export default app;
