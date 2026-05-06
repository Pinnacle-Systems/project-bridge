import type { ContractCache } from "../contracts/contract-cache.js";
import type { OracleConnectorAdapter, BindValue } from "../connections/oracle-adapter.js";
import type {
  ResolvedApiContract,
  ApiFieldMapping
} from "../contracts/index.js";
import {
  buildRuntimeAuditMetadata,
  extractOracleErrorCode,
  type AuditLogger
} from "../audit/index.js";
import type { PermissionChecker, RequestIdentity } from "./permissions.js";
import { transformReadValue, applyReadPermissionMask } from "../transformers/engine.js";
import { translateOracleError } from "../errors/translator.js";
import {
  buildOutBind,
  buildProcedureName,
  type OracleBindTypeRegistry
} from "./oracle-helpers.js";

// ─── Cursor abstraction ─────────────────────────────────────────────────
// Oracle's oracledb ResultSet is modelled here as a thin interface so the
// handler can iterate rows and close the cursor without depending on the
// native driver at compile time.

export type CursorLike = {
  /** Fetch up to `numRows` rows. Returns empty array when exhausted. */
  getRows(numRows: number): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
};

// ─── Public types ───────────────────────────────────────────────────────

export type CursorReadHandlerContext = {
  cache: ContractCache;
  adapter: OracleConnectorAdapter;
  permissions: PermissionChecker;
  audit?: AuditLogger;
  oracleBindTypes: OracleBindTypeRegistry;
  /** Per-fetch batch size when iterating the cursor. Default: 100. */
  fetchBatchSize?: number;
};

export type CursorReadHandlerInput = {
  contractPath: string;
  /** IN params sent by the caller (e.g. id for read-by-id). */
  params?: Record<string, unknown>;
  identity?: RequestIdentity;
  requestId?: string;
  /** Override the contract-level maxRowLimit for this request. */
  maxRows?: number;
};

export type CursorReadHandlerOutput = {
  status: number;
  body: unknown;
};

// ─── Default limits ─────────────────────────────────────────────────────

const DEFAULT_FETCH_BATCH = 100;
const DEFAULT_MAX_ROWS = 1000;

// ─── Handler factory ────────────────────────────────────────────────────

export function createCursorReadHandler(ctx: CursorReadHandlerContext) {
  return async function handle(input: CursorReadHandlerInput): Promise<CursorReadHandlerOutput> {
    const startedAt = Date.now();
    // 1. Resolve contract
    const contract = ctx.cache.getContractByEndpoint("GET", input.contractPath);
    if (!contract) {
      return { status: 404, body: { error: "No contract found for this endpoint." } };
    }

    // 2. Validate operation enabled and mode is package/procedure
    // Cursor reads always return a collection, so resolve against the "list" policy.
    const policy = contract.operations.find(op => op.operation === "list");
    if (!policy?.enabled) {
      return { status: 404, body: { error: "Not found." } };
    }

    if (contract.source.type !== "package" && contract.source.type !== "procedure") {
      return {
        status: 400,
        body: { error: `Procedure-backed reads require a package or procedure source, got '${contract.source.type}'.` }
      };
    }

    if (!contract.procedureParams?.length) {
      return { status: 500, body: { error: "Contract is missing procedure parameter mappings." } };
    }

    if (!contract.sysRefCursor) {
      return { status: 500, body: { error: "Contract is missing SYS_REFCURSOR mapping." } };
    }

    // Permission check
    if (policy.permission && !ctx.permissions.check(input.identity, policy.permission)) {
      return { status: 403, body: { error: "Forbidden." } };
    }

    ctx.audit?.log({
      type: "runtime.request.received",
      metadata: buildRuntimeAuditMetadata({
        contract,
        operation: policy.operation,
        status: "received",
        startedAt,
        requestId: input.requestId,
        userId: input.identity?.userId
      })
    });

    // 3. Bind IN params from request
    const binds: Record<string, BindValue> = {};
    for (const param of contract.procedureParams) {
      if (param.direction === "in" || param.direction === "inout") {
        if (param.apiField && input.params?.[param.apiField] !== undefined) {
          binds[param.paramName] = input.params[param.apiField] as BindValue;
        } else if (param.required) {
          return {
            status: 400,
            body: { error: `Required parameter '${param.apiField ?? param.paramName}' is missing.` }
          };
        }
      }

      // 4. Bind OUT SYS_REFCURSOR
      if (
        param.oracleType === "sys_refcursor" &&
        (param.direction === "out" || param.direction === "return")
      ) {
        binds[param.paramName] = buildOutBind(param.oracleType, ctx.oracleBindTypes);
      }
    }

    // Build PL/SQL block
    const qualifiedProcedure = buildProcedureName(contract);
    const paramPlaceholders = contract.procedureParams
      .filter(p => binds[p.paramName] !== undefined)
      .map(p => `${p.paramName} => :${p.paramName}`)
      .join(", ");
    const plsqlBlock = `BEGIN ${qualifiedProcedure}(${paramPlaceholders}); END;`;

    // 5. Execute PL/SQL block
    let outBinds: Record<string, unknown>;
    try {
      const result = await ctx.adapter.executePlsqlBlock(plsqlBlock, binds);
      outBinds = (result.outBinds as Record<string, unknown>) ?? {};
    } catch (err) {
      const oracleErrorCode = extractOracleErrorCode(err);
      const translated = translateOracleError(err, contract);
      ctx.audit?.log({
        type: "runtime.oracle.error",
        metadata: buildRuntimeAuditMetadata({
          contract,
          operation: policy.operation,
          status: "failed",
          startedAt,
          requestId: input.requestId,
          userId: input.identity?.userId,
          oracleErrorCode,
          code: translated.code
        })
      });
      return {
        status: translated.statusCode,
        body: { error: translated.message, code: translated.code }
      };
    }

    // 6. Iterate cursor rows
    const cursorParamName = contract.sysRefCursor.paramName;
    const cursor = outBinds[cursorParamName] as CursorLike | undefined;

    if (!cursor || typeof cursor.getRows !== "function") {
      return { status: 500, body: { error: "Procedure did not return a valid cursor." } };
    }

    const cursorFields = contract.sysRefCursor.fields;
    const readableFields = cursorFields.filter(f => !f.writeOnly);
    const allowedSet = policy.allowedFields ? new Set(policy.allowedFields) : undefined;
    const maxRows = input.maxRows ?? contract.pagination?.maxLimit ?? DEFAULT_MAX_ROWS;
    const batchSize = ctx.fetchBatchSize ?? DEFAULT_FETCH_BATCH;

    const mappedRows: Record<string, unknown>[] = [];
    let limitReached = false;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await cursor.getRows(batchSize);
        if (!batch.length) break;

        for (const row of batch) {
          if (mappedRows.length >= maxRows) {
            limitReached = true;
            break;
          }
          // 7/8. Apply rowMapping, Oracle type normalization, and transformers
          mappedRows.push(mapCursorRow(row, readableFields, allowedSet));
        }

        if (limitReached || batch.length < batchSize) break;
      }
    } catch (err) {
      // 12. Close cursor safely on iteration error
      await closeCursorSafely(cursor);

      const oracleErrorCode = extractOracleErrorCode(err);
      const translated = translateOracleError(err, contract);
      ctx.audit?.log({
        type: "runtime.oracle.error",
        metadata: buildRuntimeAuditMetadata({
          contract,
          operation: policy.operation,
          status: "failed",
          startedAt,
          requestId: input.requestId,
          userId: input.identity?.userId,
          oracleErrorCode,
          code: translated.code
        })
      });
      return {
        status: translated.statusCode,
        body: { error: translated.message, code: translated.code }
      };
    }

    // 12. Close cursor safely on success
    await closeCursorSafely(cursor);

    // 13. Write audit log
    ctx.audit?.log({
      type: "runtime.sys_refcursor.read",
      metadata: buildRuntimeAuditMetadata({
        contract,
        operation: policy.operation,
        status: "succeeded",
        startedAt,
        requestId: input.requestId,
        userId: input.identity?.userId,
        resultCount: mappedRows.length
      })
    });
    ctx.audit?.log({
      type: "runtime.request.succeeded",
      metadata: buildRuntimeAuditMetadata({
        contract,
        operation: policy.operation,
        status: "succeeded",
        startedAt,
        requestId: input.requestId,
        userId: input.identity?.userId,
        resultCount: mappedRows.length
      })
    });

    // 10. Convert rows to JSON array
    return {
      status: 200,
      body: { data: mappedRows, ...(limitReached ? { truncated: true } : {}) }
    };
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Map a single cursor row through the read pipeline: transform → mask. */
function mapCursorRow(
  row: Record<string, unknown>,
  fields: ApiFieldMapping[],
  allowedFields: ReadonlySet<string> | undefined
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const dbKey = field.dbColumn ?? field.apiField;
    const transformed = transformReadValue(row[dbKey], field);
    const masked = applyReadPermissionMask(transformed, field, allowedFields);
    if (masked !== undefined) {
      result[field.apiField] = masked;
    }
  }
  return result;
}

/** Close a cursor, swallowing any error so callers don't mask the original. */
async function closeCursorSafely(cursor: CursorLike): Promise<void> {
  try {
    await cursor.close();
  } catch {
    // Intentionally swallowed — the original error is more important.
  }
}
