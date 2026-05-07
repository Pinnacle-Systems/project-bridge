import { Router, type Request, type Response } from "express";
import { createReadHandler } from "../runtime/read-handler.js";
import { createWriteHandler } from "../runtime/write-handler.js";
import { createDirectWriteHandler } from "../runtime/direct-write-handler.js";
import { createCursorReadHandler } from "../runtime/cursor-read-handler.js";
import type { ContractCache } from "../contracts/contract-cache.js";
import type { OracleConnectorAdapter } from "../connections/oracle-adapter.js";
import type { PermissionChecker, RequestIdentity } from "../runtime/permissions.js";
import type { AuditLogger } from "../audit/index.js";
import type { OracleBindTypeRegistry } from "../runtime/oracle-helpers.js";
import type { OraclePaginationStrategy } from "../contracts/index.js";
import type { QueryRequestFilter } from "../database/query-builder.js";

export type RuntimeDispatchContext = {
  cache: ContractCache;
  adapter: OracleConnectorAdapter;
  permissions: PermissionChecker;
  oracleBindTypes: OracleBindTypeRegistry;
  audit?: AuditLogger;
  paginationStrategy?: OraclePaginationStrategy;
};

export type RuntimeDispatchInput = {
  method: string;
  contractPath: string;
  idParam?: string;
  body?: Record<string, unknown>;
  filters?: QueryRequestFilter[];
  limit?: number;
  offset?: number;
  identity?: RequestIdentity;
  requestId?: string;
};

export type RuntimeDispatchOutput = { status: number; body: unknown };

export function createRuntimeDispatcher(ctx: RuntimeDispatchContext) {
  const readHandler        = createReadHandler(ctx);
  const writeHandler       = createWriteHandler(ctx);
  const directWriteHandler = createDirectWriteHandler(ctx);
  const cursorReadHandler  = createCursorReadHandler(ctx);

  return async function dispatch(input: RuntimeDispatchInput): Promise<RuntimeDispatchOutput> {
    const contract = ctx.cache.getContractByEndpoint(input.method, input.contractPath);
    if (!contract) {
      return { status: 404, body: { error: "No contract found for this endpoint." } };
    }

    const { source } = contract;
    const m = input.method.toUpperCase();

    if (source.type === "table" || source.type === "view") {
      if (m === "GET") {
        return readHandler({
          contractPath: input.contractPath,
          idParam: input.idParam,
          filters: input.filters,
          limit: input.limit,
          offset: input.offset,
          identity: input.identity,
          requestId: input.requestId
        });
      }
      if (m === "POST") {
        return directWriteHandler({
          contractPath: input.contractPath,
          method: "POST",
          body: input.body ?? {},
          identity: input.identity,
          requestId: input.requestId
        });
      }
      if (m === "PATCH") {
        return directWriteHandler({
          contractPath: input.contractPath,
          method: "PATCH",
          body: input.body ?? {},
          idParam: input.idParam,
          identity: input.identity,
          requestId: input.requestId
        });
      }
    }

    if (source.type === "package" || source.type === "procedure") {
      if (m === "GET") {
        return cursorReadHandler({
          contractPath: input.contractPath,
          identity: input.identity,
          requestId: input.requestId
        });
      }
      if (m === "POST" || m === "PUT") {
        return writeHandler({
          contractPath: input.contractPath,
          method: m === "POST" ? "POST" : "PUT",
          body: input.body ?? {},
          identity: input.identity,
          requestId: input.requestId
        });
      }
    }

    return { status: 405, body: { error: "Method not allowed for this contract." } };
  };
}

// ─── Express middleware ──────────────────────────────────────────────────────

export function createRuntimeRouter(ctx: RuntimeDispatchContext): Router {
  const router = Router();
  const dispatch = createRuntimeDispatcher(ctx);

  router.use(async (req: Request, res: Response) => {
    const filters = parseFilters(req.query);
    const limit   = req.query.limit  !== undefined ? Number(req.query.limit)  : undefined;
    const offset  = req.query.offset !== undefined ? Number(req.query.offset) : undefined;

    // Try exact path first (matches list/create/update on the collection endpoint)
    let contractPath = req.path;
    let idParam: string | undefined;

    let contract = ctx.cache.getContractByEndpoint(req.method, contractPath);

    // Try parent path (last segment may be a record ID)
    if (!contract) {
      const lastSlash = req.path.lastIndexOf("/");
      if (lastSlash > 0) {
        const basePath = req.path.slice(0, lastSlash);
        const potentialId = req.path.slice(lastSlash + 1);
        if (ctx.cache.getContractByEndpoint(req.method, basePath)) {
          contractPath = basePath;
          idParam = potentialId;
          contract = ctx.cache.getContractByEndpoint(req.method, basePath);
        }
      }
    }

    const { status, body } = await dispatch({
      method: req.method,
      contractPath,
      idParam,
      body: req.body,
      filters,
      limit,
      offset,
      identity: (req as any).identity,
      requestId: (req as any).requestId
    });

    res.status(status).json(body);
  });

  return router;
}

function parseFilters(query: Request["query"]): QueryRequestFilter[] {
  const raw = query["filter"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string")
    .map(([field, value]) => ({ field, operator: "eq", value: value as string }));
}
