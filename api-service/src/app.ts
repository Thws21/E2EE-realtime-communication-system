import express from "express";
import helmet from "helmet";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { pingDb } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { conversationsRouter } from "./routes/conversations.js";
import { callsRouter } from "./routes/calls.js";
import { devicesRouter } from "./routes/devices.js";
import { internalRouter } from "./routes/internal.js";
import { messagesRouter } from "./routes/messages.js";
import { usersRouter } from "./routes/users.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/conversations", conversationsRouter);
  app.use("/api/v1/conversations/:conversationId/calls", callsRouter);
  app.use("/api/v1", messagesRouter);
  app.use("/api/v1/internal", internalRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/devices", devicesRouter);

  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      data: { status: "ok" },
      meta: {},
    });
  });

  app.get("/ready", async (_req, res) => {
    const requestId = randomUUID();
    try {
      await pingDb();
      res.json({
        success: true,
        data: { status: "ready", database: "up" },
        meta: {},
      });
    } catch {
      res.status(503).json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Database not ready",
          requestId,
        },
      });
    }
  });

  return app;
}
