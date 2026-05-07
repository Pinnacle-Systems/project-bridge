import { Router, type Request, type Response } from "express";
import { createAdminHandlers, type AdminHandlers } from "./admin-handlers.js";
import type { BridgeHttpContext } from "./context.js";

function wire(
  router: Router,
  method: "get" | "post" | "put" | "patch" | "delete",
  path: string,
  fn: (req: Request) => Promise<{ status: number; body: unknown }>
): void {
  router[method](path, async (req: Request, res: Response) => {
    const { status, body } = await fn(req);
    res.status(status).json(body);
  });
}

export function createAdminRouter(ctx: BridgeHttpContext): Router {
  const router = Router();
  const h: AdminHandlers = createAdminHandlers(ctx);

  // ── Connections ────────────────────────────────────────────────────────────
  wire(router, "post",   "/connections",                       req => h.createConnection(req.body));
  wire(router, "get",    "/connections",                       ()  => h.listConnections());
  wire(router, "get",    "/connections/:id",                   req => h.getConnection(req.params.id));
  wire(router, "post",   "/connections/:id/test",              req => h.testConnection(req.params.id));
  wire(router, "post",   "/connections/:id/detect-capabilities", req => h.detectCapabilities(req.params.id));
  wire(router, "post",   "/connections/:id/inspect",           req => h.inspectSchema(req.params.id, req.body));

  // ── Schema snapshots ───────────────────────────────────────────────────────
  wire(router, "get",    "/schema-snapshots",                  req => h.listSnapshots(req.query.connectionId as string | undefined));
  wire(router, "get",    "/schema-snapshots/:id",              req => h.getSnapshot(req.params.id));

  // ── Draft contracts ────────────────────────────────────────────────────────
  wire(router, "post",   "/contracts/drafts",                  req => h.createDraft(req.body));
  wire(router, "get",    "/contracts/drafts",                  req => h.listDrafts(req.query as Record<string, string>));
  wire(router, "get",    "/contracts/drafts/:id",              req => h.getDraft(req.params.id));
  wire(router, "patch",  "/contracts/drafts/:id",              req => h.updateDraft(req.params.id, req.body));
  wire(router, "post",   "/contracts/drafts/:id/archive",      req => h.archiveDraft(req.params.id));
  wire(router, "post",   "/contracts/drafts/:id/publish",      req => h.publishDraft(req.params.id, req.body));

  // ── Compiler ───────────────────────────────────────────────────────────────
  wire(router, "post",   "/compiler/validate",                 req => h.validateDraft(req.body));
  wire(router, "post",   "/compiler/compile",                  req => h.compileDraft(req.body));

  // ── Published contracts ────────────────────────────────────────────────────
  wire(router, "get",    "/contracts/published",               ()  => h.listPublished());
  wire(router, "get",    "/contracts/published/:id",           req => h.getPublished(req.params.id));

  // ── Cache ──────────────────────────────────────────────────────────────────
  wire(router, "post",   "/cache/reload",                      ()  => h.reloadCache());
  wire(router, "get",    "/cache/status",                      ()  => h.getCacheStatus());

  // ── Diagnostics ────────────────────────────────────────────────────────────
  wire(router, "get",    "/diagnostics/compiler",              req => h.getCompilerDiagnostics(req.query.draftId as string | undefined));
  wire(router, "get",    "/diagnostics/audit",                 req => h.getAuditLogs(req.query as Record<string, string>));

  return router;
}
