import { Router, type NextFunction, type Request, type Response } from "express";
import { createAdminHandlers, type AdminHandlers } from "./admin-handlers.js";
import type { BridgeHttpContext } from "./context.js";
import { badRequest } from "../../error-handler.js";

function wire(
  router: Router,
  method: "get" | "post" | "put" | "patch" | "delete",
  path: string,
  fn: (req: Request) => Promise<{ status: number; body: unknown }>
): void {
  router[method](path, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, body } = await fn(req);
      res.status(status).json(body);
    } catch (error) {
      next(error);
    }
  });
}

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function queryString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function uuidParam(value: string | string[] | undefined, field = "id"): string {
  const id = routeParam(value);
  if (!isUuid(id)) {
    throw badRequest(`Route parameter '${field}' must be a valid UUID.`, [
      { field, message: `Expected a UUID, received '${id || "<empty>"}'.` }
    ]);
  }
  return id;
}

function optionalUuidQuery(value: unknown, field: string): string | undefined {
  const id = queryString(value);
  if (id !== undefined && !isUuid(id)) {
    throw badRequest(`Query parameter '${field}' must be a valid UUID.`, [
      { field, message: `Expected a UUID, received '${id}'.` }
    ]);
  }
  return id;
}

function bodyWithUuidField(body: unknown, field: string): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const value = (body as Record<string, unknown>)[field];
  if (typeof value === "string" && !isUuid(value)) {
    throw badRequest(`Body field '${field}' must be a valid UUID.`, [
      { field, message: `Expected a UUID, received '${value}'.` }
    ]);
  }

  return body;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createAdminRouter(ctx: BridgeHttpContext): Router {
  const router = Router();
  const h: AdminHandlers = createAdminHandlers(ctx);

  // ── Connections ────────────────────────────────────────────────────────────
  wire(router, "post",   "/connections",                       req => h.createConnection(req.body));
  wire(router, "get",    "/connections",                       ()  => h.listConnections());
  wire(router, "get",    "/connections/:id",                   req => h.getConnection(uuidParam(req.params.id)));
  wire(router, "post",   "/connections/:id/test",              req => h.testConnection(uuidParam(req.params.id)));
  wire(router, "post",   "/connections/:id/detect-capabilities", req => h.detectCapabilities(uuidParam(req.params.id)));
  wire(router, "post",   "/connections/:id/inspect",           req => h.inspectSchema(uuidParam(req.params.id), req.body));

  // ── Schema snapshots ───────────────────────────────────────────────────────
  wire(router, "get",    "/schema-snapshots",                  req => h.listSnapshots(optionalUuidQuery(req.query.connectionId, "connectionId")));
  wire(router, "get",    "/schema-snapshots/:id",              req => h.getSnapshot(uuidParam(req.params.id)));

  // ── Draft contracts ────────────────────────────────────────────────────────
  wire(router, "post",   "/contracts/drafts",                  req => h.createDraft(bodyWithUuidField(req.body, "apiConnectionId")));
  wire(router, "get",    "/contracts/drafts",                  req => h.listDrafts({ apiConnectionId: optionalUuidQuery(req.query.apiConnectionId, "apiConnectionId"), includeArchived: queryString(req.query.includeArchived) }));
  wire(router, "get",    "/contracts/drafts/:id",              req => h.getDraft(uuidParam(req.params.id)));
  wire(router, "patch",  "/contracts/drafts/:id",              req => h.updateDraft(uuidParam(req.params.id), req.body));
  wire(router, "post",   "/contracts/drafts/:id/archive",      req => h.archiveDraft(uuidParam(req.params.id)));
  wire(router, "post",   "/contracts/drafts/:id/publish",      req => h.publishDraft(uuidParam(req.params.id), req.body));

  // ── Compiler ───────────────────────────────────────────────────────────────
  wire(router, "post",   "/compiler/validate",                 req => h.validateDraft(req.body));
  wire(router, "post",   "/compiler/compile",                  req => h.compileDraft(req.body));

  // ── Published contracts ────────────────────────────────────────────────────
  wire(router, "get",    "/contracts/published",               ()  => h.listPublished());
  wire(router, "get",    "/contracts/published/:id",           req => h.getPublished(uuidParam(req.params.id)));

  // ── Cache ──────────────────────────────────────────────────────────────────
  wire(router, "post",   "/cache/reload",                      ()  => h.reloadCache());
  wire(router, "get",    "/cache/status",                      ()  => h.getCacheStatus());

  // ── Diagnostics ────────────────────────────────────────────────────────────
  wire(router, "get",    "/diagnostics/compiler",              req => h.getCompilerDiagnostics(optionalUuidQuery(req.query.draftId, "draftId")));
  wire(router, "get",    "/diagnostics/audit",                 req => h.getAuditLogs(req.query as Record<string, string>));

  return router;
}
