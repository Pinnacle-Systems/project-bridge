import type { ContractCache } from "../contracts/contract-cache.js";
import type { OracleConnectorAdapter, BindValue } from "../connections/oracle-adapter.js";
import type {
  ResolvedApiContract,
  ProcedureParamMapping,
  ContractOperation
} from "../contracts/index.js";
import type { AuditLogger } from "../audit/index.js";
import type { PermissionChecker, RequestIdentity } from "./permissions.js";
import { transformWriteValue } from "../transformers/engine.js";
import { translateOracleError } from "../errors/translator.js";
import {
  buildInOutBind,
  buildOutBind,
  buildProcedureName,
  type OracleBindTypeRegistry
} from "./oracle-helpers.js";

export type WriteHandlerContext = {
  cache: ContractCache;
  adapter: OracleConnectorAdapter;
  permissions: PermissionChecker;
  audit?: AuditLogger;
  oracleBindTypes: OracleBindTypeRegistry;
};

export type WriteHandlerInput = {
  contractPath: string;
  method: "POST" | "PUT";
  body: Record<string, unknown>;
  identity?: RequestIdentity;
};

export type WriteHandlerOutput = {
  status: number;
  body: unknown;
};

// ─── Handler factory ────────────────────────────────────────────────────

export function createWriteHandler(ctx: WriteHandlerContext) {
  return async function handle(input: WriteHandlerInput): Promise<WriteHandlerOutput> {
    const operation: ContractOperation = input.method === "POST" ? "create" : "update";
    const httpMethod = input.method;

    // 1. Resolve contract from cache
    const contract = ctx.cache.getContractByEndpoint(httpMethod, input.contractPath);
    if (!contract) {
      return { status: 404, body: { error: "No contract found for this endpoint." } };
    }

    // 2. Validate operation enabled and mode is package/procedure
    const policy = contract.operations.find(op => op.operation === operation);
    if (!policy?.enabled) {
      return { status: 404, body: { error: "Not found." } };
    }

    if (contract.source.type !== "package" && contract.source.type !== "procedure") {
      return {
        status: 400,
        body: { error: `Write operations require a package or procedure source, got '${contract.source.type}'.` }
      };
    }

    if (!contract.procedureParams?.length) {
      return { status: 500, body: { error: "Contract is missing procedure parameter mappings." } };
    }

    // Check permission
    if (policy.permission && !ctx.permissions.check(input.identity, policy.permission)) {
      return { status: 403, body: { error: "Forbidden." } };
    }

    // Build a map of procedure params keyed by apiField for fast lookup
    const paramsByApiField = new Map<string, ProcedureParamMapping>();
    for (const param of contract.procedureParams) {
      if (param.apiField) {
        paramsByApiField.set(param.apiField, param);
      }
    }

    // Build a field map for write-eligible API fields
    const writableFieldMap = new Map(
      contract.fields
        .filter(f => !f.readOnly)
        .map(f => [f.apiField, f] as const)
    );

    // 3. Reject unknown API fields
    for (const key of Object.keys(input.body)) {
      if (!paramsByApiField.has(key) && !writableFieldMap.has(key)) {
        return { status: 400, body: { error: `Unknown field: ${key}` } };
      }
    }

    // 4. Validate field write permissions (reject readOnly fields)
    for (const key of Object.keys(input.body)) {
      const fieldDef = contract.fields.find(f => f.apiField === key);
      if (fieldDef?.readOnly) {
        return { status: 400, body: { error: `Field '${key}' is read-only.` } };
      }
    }

    // 5. Run field validations + 6. Transform API values to Oracle bind values
    const binds: Record<string, BindValue> = {};

    for (const param of contract.procedureParams) {
      if (param.direction === "out" || param.direction === "return") {
        // 8. OUT params — set up as output bind placeholders
        binds[param.paramName] = buildOutBind(param.oracleType, ctx.oracleBindTypes);
        continue;
      }

      // IN or INOUT param
      if (param.apiField && param.apiField in input.body) {
        const fieldDef = writableFieldMap.get(param.apiField);
        const rawValue = input.body[param.apiField];

        try {
          const transformed = fieldDef
            ? transformWriteValue(rawValue, fieldDef)
            : rawValue;

          if (param.direction === "inout") {
            binds[param.paramName] = buildInOutBind(transformed as BindValue, param.oracleType, ctx.oracleBindTypes);
          } else {
            binds[param.paramName] = transformed as BindValue;
          }
        } catch (err) {
          return { status: 400, body: { error: (err as Error).message } };
        }
      } else if (param.required) {
        return { status: 400, body: { error: `Required field '${param.apiField ?? param.paramName}' is missing.` } };
      }
    }

    // 7. Build safe PL/SQL block
    const qualifiedProcedure = buildProcedureName(contract);
    const paramPlaceholders = contract.procedureParams
      .filter(p => binds[p.paramName] !== undefined)
      .map(p => `${p.paramName} => :${p.paramName}`)
      .join(", ");
    const plsqlBlock = `BEGIN ${qualifiedProcedure}(${paramPlaceholders}); END;`;

    // 9. Execute using Oracle adapter
    let outBinds: Record<string, unknown> | undefined;
    try {
      const result = await ctx.adapter.executePlsqlBlock(plsqlBlock, binds, { autoCommit: true });
      outBinds = result.outBinds as Record<string, unknown> | undefined;
    } catch (err) {
      // 11. Translate Oracle/PL-SQL errors
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

    // 10. Map OUT params to API response
    const responseData: Record<string, unknown> = {};
    for (const param of contract.procedureParams) {
      if ((param.direction === "out" || param.direction === "inout" || param.direction === "return") && param.apiField) {
        responseData[param.apiField] = outBinds?.[param.paramName] ?? null;
      }
    }

    // 12. Write audit log
    ctx.audit?.log({
      type: "runtime.request.received",
      metadata: {
        contractId: contract.id,
        contractPath: input.contractPath,
        operation,
        resultFields: Object.keys(responseData)
      }
    });

    const status = operation === "create" ? 201 : 200;
    return { status, body: { data: responseData } };
  };
}
