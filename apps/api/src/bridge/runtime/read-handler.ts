import type { ContractCache } from "../contracts/contract-cache.js";
import type { OracleConnectorAdapter } from "../connections/oracle-adapter.js";
import type { ApiFieldMapping, OraclePaginationStrategy } from "../contracts/index.js";
import type { AuditEvent } from "../audit/index.js";
import type { PermissionChecker, RequestIdentity } from "./permissions.js";
import { buildSelectQuery, type QueryRequestFilter, type QueryRequestSort } from "../database/query-builder.js";

export type AuditLogger = {
  log(event: Omit<AuditEvent, "id" | "occurredAt">): void;
};

export type ReadHandlerContext = {
  cache: ContractCache;
  adapter: OracleConnectorAdapter;
  permissions: PermissionChecker;
  audit?: AuditLogger;
  paginationStrategy?: OraclePaginationStrategy;
};

export type ReadHandlerInput = {
  contractPath: string;
  idParam?: string;
  filters?: QueryRequestFilter[];
  sorts?: QueryRequestSort[];
  limit?: number;
  offset?: number;
  identity?: RequestIdentity;
};

export type ReadHandlerOutput = {
  status: number;
  body: unknown;
};

export function createReadHandler(ctx: ReadHandlerContext) {
  return async function handle(input: ReadHandlerInput): Promise<ReadHandlerOutput> {
    const operation = input.idParam !== undefined ? "read" : "list";

    // Step 1: Resolve contract from cache
    const contract = ctx.cache.getContractByEndpoint("GET", input.contractPath);
    if (!contract) {
      return { status: 404, body: { error: "No contract found for this endpoint." } };
    }

    // Step 3: Check operation enabled
    const policy = contract.operations.find(op => op.operation === operation);
    if (!policy?.enabled) {
      return { status: 404, body: { error: "Not found." } };
    }

    // Step 4: Check permission
    if (policy.permission && !ctx.permissions.check(input.identity, policy.permission)) {
      return { status: 403, body: { error: "Forbidden." } };
    }

    // Steps 5/6: Build query — validates filters, sorts, and pagination
    const filters: QueryRequestFilter[] = [...(input.filters ?? [])];
    if (input.idParam !== undefined) {
      filters.push({ field: "id", operator: "eq", value: input.idParam });
    }

    let sql: string;
    let binds: Record<string, unknown>;
    try {
      const built = buildSelectQuery(
        contract,
        { filters, sorts: input.sorts, limit: input.limit, offset: input.offset },
        { paginationStrategy: ctx.paginationStrategy }
      );
      sql = built.sql;
      binds = built.binds;
    } catch (err) {
      return { status: 400, body: { error: (err as Error).message } };
    }

    // Step 7: Execute against Oracle
    let rows: Record<string, unknown>[];
    try {
      const result = await ctx.adapter.query<Record<string, unknown>>(sql, binds, { outFormat: "object" });
      rows = result.rows;
    } catch (err) {
      ctx.audit?.log({
        type: "runtime.request.failed",
        metadata: {
          contractId: contract.id,
          contractPath: input.contractPath,
          error: (err as Error).message
        }
      });
      return { status: 500, body: { error: "Database error." } };
    }

    // Steps 8/9/10: Map DB columns → API fields, apply transformers, apply field-level permissions
    const readableFields = contract.fields.filter(f => !f.writeOnly);
    const mapped = rows.map(row => mapRow(row, readableFields, policy.allowedFields));

    // Step 12: Audit successful request
    ctx.audit?.log({
      type: "runtime.request.received",
      metadata: {
        contractId: contract.id,
        contractPath: input.contractPath,
        operation,
        resultCount: mapped.length
      }
    });

    // Step 11: Return JSON response
    if (operation === "read") {
      if (mapped.length === 0) return { status: 404, body: { error: "Not found." } };
      return { status: 200, body: { data: mapped[0] } };
    }
    return { status: 200, body: { data: mapped } };
  };
}

function mapRow(
  row: Record<string, unknown>,
  fields: ApiFieldMapping[],
  allowedApiFields?: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (allowedApiFields && !allowedApiFields.includes(field.apiField)) continue;
    result[field.apiField] = applyTransformers(row[field.dbColumn!], field);
  }
  return result;
}

function applyTransformers(value: unknown, field: ApiFieldMapping): unknown {
  if (!field.transformers?.length) return value;
  let result = value;
  for (const transformer of field.transformers) {
    switch (transformer.kind) {
      case "booleanMapping":
        result = result === transformer.trueValue ? true
               : result === transformer.falseValue ? false
               : null;
        break;
      case "trimRight":
        if (typeof result === "string") result = result.trimEnd();
        break;
    }
  }
  return result;
}
