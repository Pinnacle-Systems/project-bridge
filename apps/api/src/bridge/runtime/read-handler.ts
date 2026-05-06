import type { ContractCache } from "../contracts/contract-cache.js";
import type { OracleConnectorAdapter } from "../connections/oracle-adapter.js";
import type { ApiFieldMapping, OraclePaginationStrategy } from "../contracts/index.js";
import type { AuditEvent } from "../audit/index.js";
import type { PermissionChecker, RequestIdentity } from "./permissions.js";
import { buildSelectQuery, type QueryRequestFilter, type QueryRequestSort } from "../database/query-builder.js";
import { transformReadValue, applyReadPermissionMask } from "../transformers/engine.js";
import { translateOracleError } from "../errors/translator.js";

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
      const result = await ctx.adapter.query<Record<string, unknown>>(sql, binds as any, { outFormat: "object" });
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
      const translated = translateOracleError(err, contract);
      return {
        status: translated.statusCode,
        body: {
          error: translated.message,
          code: translated.code,
          ...(translated.field ? { field: translated.field } : {})
        }
      };
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
  const allowedSet = allowedApiFields ? new Set(allowedApiFields) : undefined;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    // Steps 8/9: map DB column -> API field, apply transformers
    const transformed = transformReadValue(row[field.dbColumn!], field);
    // Step 10: permission masking (undefined means field is hidden)
    const masked = applyReadPermissionMask(transformed, field, allowedSet);
    if (masked !== undefined) {
      result[field.apiField] = masked;
    }
  }
  return result;
}
