import type { ResolvedApiContract } from "../contracts/index.js";
import type { BridgeApiError } from "./index.js";

// ORA-NNNNN followed by optional space/colon and then optionally the constraint
// in parentheses: (OWNER.CONSTRAINT_NAME)
const ORA_CODE_RE = /ORA-(\d{5})/;
const CONSTRAINT_RE = /\(([^)]+)\)/;

/**
 * Extract the first ORA-XXXXX code from a raw Oracle error message.
 */
function extractOraCode(message: string): string | undefined {
  const m = ORA_CODE_RE.exec(message);
  return m ? `ORA-${m[1]}` : undefined;
}

/**
 * Extract the unqualified constraint name from an Oracle error message.
 * Oracle renders them as (OWNER.CONSTRAINT_NAME) — we want CONSTRAINT_NAME only
 * so that comparisons work regardless of schema prefix.
 */
function extractConstraintName(message: string): string | undefined {
  const m = CONSTRAINT_RE.exec(message);
  if (!m) return undefined;
  const qualified = m[1]; // e.g. "HR.EMP_EMAIL_UK"
  const dot = qualified.indexOf(".");
  return dot >= 0 ? qualified.slice(dot + 1) : qualified;
}

const DEFAULT_MAPPINGS: Record<string, Omit<BridgeApiError, "field" | "requestId">> = {
  "ORA-00001": { statusCode: 409, code: "UNIQUE_CONSTRAINT",        message: "unique constraint" },
  "ORA-02291": { statusCode: 409, code: "PARENT_KEY_MISSING",       message: "parent key missing" },
  "ORA-02292": { statusCode: 409, code: "CHILD_RECORD_EXISTS",      message: "child record exists" },
  "ORA-01400": { statusCode: 400, code: "REQUIRED_FIELD_MISSING",   message: "required field missing" },
  "ORA-01438": { statusCode: 400, code: "PRECISION_TOO_LARGE",      message: "precision/value too large" },
  "ORA-12899": { statusCode: 400, code: "VALUE_TOO_LARGE",          message: "value too large for column" },
  "ORA-00942": { statusCode: 500, code: "CONTRACT_SCHEMA_MISMATCH", message: "This API contract no longer matches the underlying Oracle schema." },
  "ORA-00904": { statusCode: 500, code: "CONTRACT_SCHEMA_MISMATCH", message: "This API contract no longer matches the underlying Oracle schema." },
  "ORA-01031": { statusCode: 500, code: "CONTRACT_SCHEMA_MISMATCH", message: "This API contract no longer matches the underlying Oracle schema." },
  "ORA-06550": { statusCode: 500, code: "PLSQL_EXECUTION_ERROR",    message: "PL/SQL execution error" },
  "ORA-04063": { statusCode: 500, code: "CONTRACT_SCHEMA_MISMATCH", message: "This API contract no longer matches the underlying Oracle schema." },
  "ORA-01403": { statusCode: 404, code: "NOT_FOUND",                message: "not found" }
};

export function translateOracleError(
  error: Error | unknown,
  contract?: ResolvedApiContract
): BridgeApiError {
  const errorMessage = error instanceof Error ? error.message : String(error);

  const oraCode = extractOraCode(errorMessage);

  if (!oraCode) {
    return {
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected database error occurred."
    };
  }

  if (contract?.errorMappings?.length) {
    const constraintName = extractConstraintName(errorMessage);

    for (const mapping of contract.errorMappings) {
      // Constraint-name match: exact case-insensitive comparison against parsed name
      if (
        mapping.constraintName &&
        constraintName &&
        mapping.constraintName.toUpperCase() === constraintName.toUpperCase()
      ) {
        return {
          statusCode: mapping.httpStatus,
          code: mapping.apiCode,
          message: mapping.message,
          field: mapping.apiField
        };
      }

      // ORA-code match
      if (mapping.oracleCode && mapping.oracleCode === oraCode) {
        return {
          statusCode: mapping.httpStatus,
          code: mapping.apiCode,
          message: mapping.message,
          field: mapping.apiField
        };
      }
    }
  }

  if (DEFAULT_MAPPINGS[oraCode]) {
    return { ...DEFAULT_MAPPINGS[oraCode] };
  }

  return {
    statusCode: 500,
    code: "DATABASE_ERROR",
    message: "A database error occurred."
  };
}
