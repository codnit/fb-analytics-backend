import "dotenv/config";
import app from "./src/app";
import { connectDB } from "./src/config/database";
import { Environment } from "./src/config/environment";
import adminAuthController from "./src/controllers/adminAuth.controller";

const startServer = async (): Promise<void> => {
  try {
    await connectDB();
    await adminAuthController.ensureAdminExists();

    // Register repeatable cron jobs in BullMQ (safe to call on every restart)
    const { startCronScheduler } = await import("./src/cron/scheduler");
    await startCronScheduler();

    const server = app.listen(Environment.port, () => {
      console.log(`Server is running on http://localhost:${Environment.port}`);
      console.log(`Environment: ${Environment.nodeEnv}`);
      console.log(`API Base: http://localhost:${Environment.port}${Environment.apiPrefix}`);
    });

    process.on("unhandledRejection", (reason: unknown) => {
      console.error("Unhandled Rejection:", reason);
      server.close(() => process.exit(1));
    });

    process.on("uncaughtException", (error: Error) => {
      console.error("Uncaught Exception:", error);
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

void startServer();

export default app;
