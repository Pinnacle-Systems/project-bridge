import type { ContractCache } from "../contracts/contract-cache.js";
import type { OracleConnectorAdapter } from "../connections/oracle-adapter.js";
import type {
  ResolvedApiContract,
  ApiFieldMapping,
  ContractOperation,
  IdGenerationConfig
} from "../contracts/index.js";
import type { AuditLogger } from "../audit/index.js";
import type { PermissionChecker, RequestIdentity } from "./permissions.js";
import { transformWriteValue } from "../transformers/engine.js";
import { translateOracleError } from "../errors/translator.js";
import { quoteIdentifier } from "../database/query-builder.js";
import { buildOutBind, type OracleBindTypeRegistry } from "./oracle-helpers.js";

export type DirectWriteHandlerContext = {
  cache: ContractCache;
  adapter: OracleConnectorAdapter;
  permissions: PermissionChecker;
  audit?: AuditLogger;
  oracleBindTypes: OracleBindTypeRegistry;
};

export type DirectWriteHandlerInput = {
  contractPath: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  /** Primary key value — required for PATCH/update. */
  idParam?: string;
  identity?: RequestIdentity;
};

export type DirectWriteHandlerOutput = {
  status: number;
  body: unknown;
};

// ─── Handler factory ────────────────────────────────────────────────────

export function createDirectWriteHandler(ctx: DirectWriteHandlerContext) {
  return async function handle(input: DirectWriteHandlerInput): Promise<DirectWriteHandlerOutput> {
    const operation: ContractOperation = input.method === "POST" ? "create" : "update";
    const httpMethod = input.method;

    // 1. Resolve contract
    const contract = ctx.cache.getContractByEndpoint(httpMethod, input.contractPath);
    if (!contract) {
      return { status: 404, body: { error: "No contract found for this endpoint." } };
    }

    // 2. Validate operation enabled and mode is direct_table
    const policy = contract.operations.find(op => op.operation === operation);
    if (!policy?.enabled) {
      return { status: 404, body: { error: "Not found." } };
    }

    if (policy.mode !== "direct_table") {
      return {
        status: 400,
        body: { error: "Direct table writes are not enabled for this operation." }
      };
    }

    if (contract.source.type !== "table") {
      return {
        status: 400,
        body: { error: `Direct writes require a table source, got '${contract.source.type}'.` }
      };
    }

    // Permission check
    if (policy.permission && !ctx.permissions.check(input.identity, policy.permission)) {
      return { status: 403, body: { error: "Forbidden." } };
    }

    // Build writable field map
    const writableFields = contract.fields.filter(f => !f.readOnly);
    const writableFieldMap = new Map(writableFields.map(f => [f.apiField, f] as const));
    const allFieldMap = new Map(contract.fields.map(f => [f.apiField, f] as const));

    // 3. Reject unknown fields
    for (const key of Object.keys(input.body)) {
      if (!allFieldMap.has(key)) {
        return { status: 400, body: { error: `Unknown field: ${key}` } };
      }
    }

    // 4. Reject read-only fields
    for (const key of Object.keys(input.body)) {
      const fieldDef = allFieldMap.get(key)!;
      if (fieldDef.readOnly) {
        return { status: 400, body: { error: `Field '${key}' is read-only.` } };
      }
    }

    // 5 & 6. Validate + transform each value
    const columns: string[] = [];
    const binds: Record<string, unknown> = {};
    let bindIndex = 1;

    for (const [apiField, value] of Object.entries(input.body)) {
      const fieldDef = writableFieldMap.get(apiField);
      if (!fieldDef || !fieldDef.dbColumn) continue;

      try {
        const transformed = transformWriteValue(value, fieldDef);
        const bindKey = `p${bindIndex++}`;
        columns.push(fieldDef.dbColumn);
        binds[bindKey] = transformed;
      } catch (err) {
        return { status: 400, body: { error: (err as Error).message } };
      }
    }

    if (columns.length === 0) {
      return { status: 400, body: { error: "No writable fields provided." } };
    }

    const owner = contract.source.owner;
    const tableName = contract.source.name!;
    const qualifiedTable = `${quoteIdentifier(owner)}.${quoteIdentifier(tableName)}`;

    let sql: string;
    let responseData: Record<string, unknown> = {};

    if (operation === "create") {
      const pkField = contract.fields.find(f => f.readOnly && f.dbColumn);
      const result = buildInsertSql(qualifiedTable, columns, binds, contract.idGeneration, pkField, ctx.oracleBindTypes);
      sql = result.sql;
      Object.assign(binds, result.extraBinds);
    } else {
      // PATCH update
      if (!input.idParam) {
        return { status: 400, body: { error: "Update requires a primary key (idParam)." } };
      }

      // Find the primary key field (first readOnly integer field, or "id")
      const pkField = contract.fields.find(f => f.readOnly && f.dbColumn) ?? contract.fields.find(f => f.apiField === "id");
      if (!pkField?.dbColumn) {
        return { status: 500, body: { error: "Contract has no identifiable primary key field." } };
      }

      sql = buildUpdateSql(qualifiedTable, columns, pkField.dbColumn);
      binds.pkValue = input.idParam;
    }

    // Execute
    try {
      const result = await ctx.adapter.execute(sql, binds as any, { autoCommit: true });

      // Both sequence and trigger return the generated PK via RETURNING INTO :generatedId.
      if (operation === "create" && contract.idGeneration) {
        const outBinds = result.outBinds as Record<string, unknown> | undefined;
        if (outBinds?.generatedId != null) {
          const pkField = contract.fields.find(f => f.readOnly && f.dbColumn);
          if (pkField) responseData[pkField.apiField] = outBinds.generatedId;
        }
      }

      if (operation === "update") {
        if (result.rowsAffected === 0) {
          return { status: 404, body: { error: "Not found." } };
        }
      }
    } catch (err) {
      ctx.audit?.log({
        type: "runtime.request.failed",
        metadata: {
          contractId: contract.id,
          contractPath: input.contractPath,
          operation,
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

    // Audit
    ctx.audit?.log({
      type: "runtime.request.received",
      metadata: {
        contractId: contract.id,
        contractPath: input.contractPath,
        operation,
        affectedColumns: columns
      }
    });

    const status = operation === "create" ? 201 : 200;
    return { status, body: { data: responseData } };
  };
}

// ─── SQL builders ───────────────────────────────────────────────────────

function buildInsertSql(
  qualifiedTable: string,
  columns: string[],
  binds: Record<string, unknown>,
  idGeneration: IdGenerationConfig | undefined,
  pkField: ApiFieldMapping | undefined,
  oracleBindTypes: OracleBindTypeRegistry
): { sql: string; extraBinds: Record<string, unknown> } {
  const extraBinds: Record<string, unknown> = {};
  const insertCols = [...columns.map(c => quoteIdentifier(c))];
  const insertVals = [...Object.keys(binds).map(k => `:${k}`)];

  if (idGeneration?.strategy === "sequence") {
    const pkCol = pkField?.dbColumn ?? "ID";
    insertCols.unshift(quoteIdentifier(pkCol));
    insertVals.unshift(`${idGeneration.sequenceName}.NEXTVAL`);
  }

  let sql = `INSERT INTO ${qualifiedTable} (${insertCols.join(", ")}) VALUES (${insertVals.join(", ")})`;

  // Both strategies return the generated PK so callers don't need a second round-trip.
  if (idGeneration?.strategy === "trigger") {
    const returningCol = idGeneration.returningColumn ?? pkField?.dbColumn ?? "ID";
    sql += ` RETURNING ${quoteIdentifier(returningCol)} INTO :generatedId`;
    extraBinds.generatedId = buildOutBind("number", oracleBindTypes);
  } else if (idGeneration?.strategy === "sequence") {
    const pkCol = pkField?.dbColumn ?? "ID";
    sql += ` RETURNING ${quoteIdentifier(pkCol)} INTO :generatedId`;
    extraBinds.generatedId = buildOutBind("number", oracleBindTypes);
  }

  return { sql, extraBinds };
}

function buildUpdateSql(
  qualifiedTable: string,
  columns: string[],
  pkColumn: string
): string {
  const setClauses = columns.map((col, i) => `${quoteIdentifier(col)} = :p${i + 1}`);
  return `UPDATE ${qualifiedTable} SET ${setClauses.join(", ")} WHERE ${quoteIdentifier(pkColumn)} = :pkValue`;
}
