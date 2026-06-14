import "dotenv/config";
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
import auth from "./middleware/auth";
import apiKeyAuth from "./middleware/apiKeyAuth";

const app = express();
const corsOrigin = Environment.corsOrigin === "*" ? true : Environment.corsOrigin;

app.set("trust proxy", 1);

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
