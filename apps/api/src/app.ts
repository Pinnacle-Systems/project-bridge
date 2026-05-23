import express, { type Express } from "express";
import { createAdminRouter, type BridgeHttpContext } from "./bridge/http/index.js";
import { createAdminAuthMiddleware } from "./bridge/http/admin-auth.js";
import { createBridgeRouter } from "./bridge/runtime/bridge-router.js";
import { jsonErrorHandler } from "./error-handler.js";

export type CreateAppOptions = {
  adminApiKey: string;
};

export function createApp(ctx: BridgeHttpContext, options: CreateAppOptions): Express {
  const app = express();
  app.set("query parser", "extended");
  app.use(express.json());
  app.use("/bridge", createAdminAuthMiddleware({ apiKey: options.adminApiKey }), createAdminRouter(ctx));
  app.use("/api", createBridgeRouter(ctx));
  app.use(jsonErrorHandler);
  return app;
}
