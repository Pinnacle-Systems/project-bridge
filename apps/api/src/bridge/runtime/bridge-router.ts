// Example: wiring createReadHandler to Express 5 routes.
//
// Usage:
//   const router = createBridgeRouter({ cache, adapter, permissions, audit });
//   app.use("/api/bridge", router);
//
// Endpoints produced:
//   GET /api/bridge/:resource        → list (contract endpoint must be "/:resource")
//   GET /api/bridge/:resource/:id    → single record by id field

import { Router, type Request, type Response } from "express";
import { createReadHandler, type ReadHandlerContext } from "./read-handler.js";
import type { QueryRequestFilter } from "../database/query-builder.js";

export function createBridgeRouter(ctx: ReadHandlerContext): Router {
  const router = Router();
  const handle = createReadHandler(ctx);

  // GET /api/bridge/:resource — list
  router.get("/:resource", async (req: Request, res: Response) => {
    const { status, body } = await handle({
      contractPath: `/${req.params.resource}`,
      filters: parseFilters(req.query),
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined,
      identity: (req as any).identity
    });
    res.status(status).json(body);
  });

  // GET /api/bridge/:resource/:id — single record
  router.get("/:resource/:id", async (req: Request, res: Response) => {
    const { status, body } = await handle({
      contractPath: `/${req.params.resource}`,
      idParam: req.params.id as string,
      identity: (req as any).identity
    });
    res.status(status).json(body);
  });

  return router;
}

// Parses ?filter[field]=value → [{ field, operator: "eq", value }]
function parseFilters(query: Request["query"]): QueryRequestFilter[] {
  const raw = query["filter"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string")
    .map(([field, value]) => ({ field, operator: "eq", value: value as string }));
}
