import express, { type Express } from "express";
import { createAdminRouter, createRuntimeRouter, type BridgeHttpContext } from "./bridge/http/index.js";
import { createAdminAuthMiddleware } from "./bridge/http/admin-auth.js";
import { jsonErrorHandler } from "./error-handler.js";

export type CreateAppOptions = {
  adminApiKey: string;
};

export function createApp(ctx: BridgeHttpContext, options: CreateAppOptions): Express {
  const app = express();
  app.use(express.json());
  app.use("/bridge", createAdminAuthMiddleware({ apiKey: options.adminApiKey }), createAdminRouter(ctx));
  app.use("/api", createRuntimeRouter(ctx));
  app.use(jsonErrorHandler);
  return app;
}
