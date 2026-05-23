import { Router, type Request, type Response } from "express";
import { createReadHandler, type ReadHandlerContext } from "./read-handler.js";
import { createWriteHandler } from "./write-handler.js";
import { createDirectWriteHandler } from "./direct-write-handler.js";
import { createCursorReadHandler } from "./cursor-read-handler.js";
import type { RequestIdentity } from "./permissions.js";
import type { OracleBindTypeRegistry } from "./oracle-helpers.js";
import type { ContractOperation, OperationPolicy } from "../contracts/index.js";
import type { QueryRequestFilter, QueryRequestSort } from "../database/query-builder.js";

export type BridgeRouterContext = ReadHandlerContext & {
  oracleBindTypes: OracleBindTypeRegistry;
};

export type BridgeDispatchInput = {
  method: string;
  contractPath: string;
  idParam?: string;
  body?: Record<string, unknown>;
  filters?: QueryRequestFilter[];
  sorts?: QueryRequestSort[];
  limit?: number;
  offset?: number;
  identity?: RequestIdentity;
  requestId?: string;
};

export type BridgeDispatchOutput = {
  status: number;
  body: unknown;
};

export function createBridgeDispatcher(ctx: BridgeRouterContext) {
  const readHandler = createReadHandler(ctx);
  const writeHandler = createWriteHandler(ctx);
  const directWriteHandler = createDirectWriteHandler(ctx);
  const cursorReadHandler = createCursorReadHandler(ctx);

  return async function dispatch(input: BridgeDispatchInput): Promise<BridgeDispatchOutput> {
    const method = input.method.toUpperCase();
    const contract = ctx.cache.getContractByEndpoint(method, input.contractPath);
    if (!contract) {
      return { status: 404, body: { error: "No contract found for this endpoint." } };
    }

    if (method === "GET") {
      if (contract.sysRefCursor && hasEnabledOperation(contract.operations, "list")) {
        return cursorReadHandler({
          contractPath: input.contractPath,
          params: input.idParam ? { id: input.idParam } : undefined,
          identity: input.identity,
          requestId: input.requestId,
          maxRows: input.limit
        });
      }

      return readHandler({
        contractPath: input.contractPath,
        idParam: input.idParam,
        filters: input.filters,
        sorts: input.sorts,
        limit: input.limit,
        offset: input.offset,
        identity: input.identity,
        requestId: input.requestId
      });
    }

    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const operation: ContractOperation = method === "POST" ? "create" : "update";
      const policy = contract.operations.find(op => op.operation === operation);
      if (!policy?.enabled) {
        return { status: 405, body: { error: "Method not allowed for this contract." } };
      }

      if (policy.mode === "direct_table") {
        if (method !== "POST" && method !== "PATCH") {
          return { status: 405, body: { error: "Method not allowed for this contract." } };
        }
        return directWriteHandler({
          contractPath: input.contractPath,
          method,
          body: input.body ?? {},
          idParam: input.idParam,
          identity: input.identity,
          requestId: input.requestId
        });
      }

      if (contract.source.type === "package" || contract.source.type === "procedure") {
        return writeHandler({
          contractPath: input.contractPath,
          method: method === "POST" ? "POST" : "PUT",
          body: input.body ?? {},
          identity: input.identity,
          requestId: input.requestId
        });
      }
    }

    // DELETE contracts may be present in the cache, but delete execution is intentionally
    // unsupported for the MVP runtime until a delete handler exists.
    return { status: 405, body: { error: "Method not allowed for this contract." } };
  };
}

export function createBridgeRouter(ctx: BridgeRouterContext): Router {
  const router = Router();
  const dispatch = createBridgeDispatcher(ctx);

  router.use(async (req: Request, res: Response) => {
    const { contractPath, idParam } = resolveRuntimePath(ctx, req.method, req.path);
    const { status, body } = await dispatch({
      method: req.method,
      contractPath,
      idParam,
      body: req.body,
      filters: parseFilters(req.query),
      sorts: parseSorts(req.query),
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined,
      identity: (req as any).identity,
      requestId: (req as any).requestId
    });
    res.status(status).json(body);
  });

  return router;
}

function resolveRuntimePath(
  ctx: BridgeRouterContext,
  method: string,
  path: string
): { contractPath: string; idParam?: string } {
  if (ctx.cache.getContractByEndpoint(method, path)) {
    return { contractPath: path };
  }

  const lastSlash = path.lastIndexOf("/");
  if (lastSlash > 0) {
    const parentPath = path.slice(0, lastSlash);
    if (ctx.cache.getContractByEndpoint(method, parentPath)) {
      return {
        contractPath: parentPath,
        idParam: path.slice(lastSlash + 1)
      };
    }
  }

  return { contractPath: path };
}

function hasEnabledOperation(operations: OperationPolicy[], operation: ContractOperation): boolean {
  return operations.some(op => op.operation === operation && op.enabled);
}

// Parses ?filter[field]=value → [{ field, operator: "eq", value }]
function parseFilters(query: Request["query"]): QueryRequestFilter[] {
  const raw = query["filter"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string")
    .map(([field, value]) => ({ field, operator: "eq", value: value as string }));
}

// Parses ?sort[field]=asc → [{ field, direction: "asc" }]
function parseSorts(query: Request["query"]): QueryRequestSort[] {
  const raw = query["sort"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => v === "asc" || v === "desc")
    .map(([field, direction]) => ({ field, direction: direction as "asc" | "desc" }));
}
