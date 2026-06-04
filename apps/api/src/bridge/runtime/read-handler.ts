import type { ContractCache } from "../contracts/contract-cache.js";
import type { OracleConnectorAdapter } from "../connections/oracle-adapter.js";
import type { ApiFieldMapping, OraclePaginationStrategy, ResolvedApiContract } from "../contracts/index.js";
import {
  buildRuntimeAuditMetadata,
  extractOracleErrorCode,
  isSchemaMismatchCode,
  type AuditLogger
} from "../audit/index.js";
import type { PermissionChecker, RequestIdentity } from "./permissions.js";
import { buildSelectQuery, type QueryRequestFilter, type QueryRequestSort } from "../database/query-builder.js";
import { transformReadValue, applyReadPermissionMask } from "../transformers/engine.js";
import { translateOracleError, schemaMismatchBody } from "../errors/index.js";

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
  requestId?: string;
};

export type ReadHandlerOutput = {
  status: number;
  body: unknown;
};

export function createReadHandler(ctx: ReadHandlerContext) {
  return async function handle(input: ReadHandlerInput): Promise<ReadHandlerOutput> {
    const startedAt = Date.now();
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

    ctx.audit?.log({
      type: "runtime.request.received",
      metadata: buildRuntimeAuditMetadata({
        contract,
        operation,
        status: "received",
        startedAt,
        requestId: input.requestId,
        userId: input.identity?.userId
      })
    });

    // Step 4: Check permission
    if (policy.permission && !ctx.permissions.check(input.identity, policy.permission)) {
      return { status: 403, body: { error: "Forbidden." } };
    }

    // Steps 5/6: Build query — validates filters, sorts, and pagination
    const rawFilters: QueryRequestFilter[] = [...(input.filters ?? [])];
    if (input.idParam !== undefined) {
      rawFilters.push({ field: resolvePrimaryKeyApiField(contract), operator: "eq", value: input.idParam });
    }
    // Transform filter values from API shape → Oracle shape before binding
    // (e.g. booleanMapping: filter[isActive]=true → ACTIVE = 'Y')
    const filters = applyFilterTransformers(rawFilters, contract.fields);

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
      ctx.audit?.log({
        type: "runtime.validation.failed",
        metadata: buildRuntimeAuditMetadata({
          contract,
          operation,
          status: "failed",
          startedAt,
          requestId: input.requestId,
          userId: input.identity?.userId,
          code: "VALIDATION_FAILED"
        })
      });
      return { status: 400, body: { error: (err as Error).message } };
    }

    // Step 7: Execute against Oracle
    let rows: Record<string, unknown>[];
    try {
      const result = await ctx.adapter.query<Record<string, unknown>>(sql, binds as any, { outFormat: "object" });
      rows = result.rows;
    } catch (err) {
      const oracleErrorCode = extractOracleErrorCode(err);
      const translated = translateOracleError(err, contract);
      ctx.audit?.log({
        type: "runtime.oracle.error",
        metadata: buildRuntimeAuditMetadata({
          contract,
          operation,
          status: "failed",
          startedAt,
          requestId: input.requestId,
          userId: input.identity?.userId,
          oracleErrorCode,
          code: translated.code
        })
      });
      if (isSchemaMismatchCode(oracleErrorCode)) {
        ctx.audit?.log({
          type: "runtime.schema_mismatch",
          metadata: buildRuntimeAuditMetadata({
            contract,
            operation,
            status: "failed",
            startedAt,
            requestId: input.requestId,
            userId: input.identity?.userId,
            oracleErrorCode,
            code: translated.code
          })
        });
      }
      if (translated.code === "CONTRACT_SCHEMA_MISMATCH") {
        return { status: 500, body: schemaMismatchBody() };
      }
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
      type: "runtime.request.succeeded",
      metadata: buildRuntimeAuditMetadata({
        contract,
        operation,
        status: "succeeded",
        startedAt,
        requestId: input.requestId,
        userId: input.identity?.userId,
        resultCount: mapped.length
      })
    });

    // Step 11: Return JSON response
    if (operation === "read") {
      if (mapped.length === 0) return { status: 404, body: { error: "Not found." } };
      return { status: 200, body: { data: mapped[0] } };
    }
    return { status: 200, body: { data: mapped } };
  };
}

function resolvePrimaryKeyApiField(contract: ResolvedApiContract): string {
  const primaryKey = (contract as ResolvedApiContract & { primaryKey?: { apiField?: unknown } }).primaryKey;
  if (typeof primaryKey?.apiField === "string" && primaryKey.apiField.length > 0) {
    return primaryKey.apiField;
  }

  const explicitPrimaryKeyField = contract.fields.find(field => {
    const metadata = field as ApiFieldMapping & { primaryKey?: unknown; isPrimaryKey?: unknown };
    return (metadata.primaryKey === true || metadata.isPrimaryKey === true) && metadata.apiField;
  });
  if (explicitPrimaryKeyField) {
    return explicitPrimaryKeyField.apiField;
  }

  const readOnlyDbField = contract.fields.find(field => field.readOnly && field.dbColumn);
  return readOnlyDbField?.apiField ?? "id";
}

function applyFilterTransformers(
  filters: QueryRequestFilter[],
  fields: ApiFieldMapping[]
): QueryRequestFilter[] {
  if (filters.length === 0) return filters;
  const fieldMap = new Map(fields.map(f => [f.apiField, f]));
  return filters.map(filter => {
    const field = fieldMap.get(filter.field);
    if (!field?.transformers?.length) return filter;
    if (filter.operator === "in" && Array.isArray(filter.value)) {
      return { ...filter, value: (filter.value as unknown[]).map(v => transformFilterValue(v, field)) };
    }
    return { ...filter, value: transformFilterValue(filter.value, field) };
  });
}

function transformFilterValue(value: unknown, field: ApiFieldMapping): unknown {
  let result = value;
  for (const transformer of field.transformers!) {
    if (transformer.kind === "booleanMapping") {
      // Coerce query-string "true"/"false" to boolean before applying the Oracle mapping
      if (result === "true") result = true;
      else if (result === "false") result = false;
      if (result === true) result = transformer.trueValue;
      else if (result === false) result = transformer.falseValue;
    }
  }
  return result;
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
