export type BridgeErrorCode =
  | "CONTRACT_INVALID"
  | "CONTRACT_NOT_FOUND"
  | "ORACLE_ERROR"
  | "VALIDATION_FAILED"
  | "SCHEMA_DRIFT"
  | "UNIQUE_CONSTRAINT"
  | "PARENT_KEY_MISSING"
  | "CHILD_RECORD_EXISTS"
  | "REQUIRED_FIELD_MISSING"
  | "PRECISION_TOO_LARGE"
  | "VALUE_TOO_LARGE"
  | "CONTRACT_SCHEMA_MISMATCH"
  | "DB_PRIVILEGE_ERROR"
  | "PLSQL_EXECUTION_ERROR"
  | "INVALID_ORACLE_OBJECT"
  | "NOT_FOUND"
  | "DATABASE_ERROR"
  | "INTERNAL_SERVER_ERROR"
  | (string & {});  // allow contract-configured codes to pass through typed

/** Canonical API error returned by all Bridge runtime handlers. */
export type BridgeApiError = {
  /** HTTP status code. */
  statusCode: number;
  /** Machine-readable error code. */
  code: BridgeErrorCode;
  /** Human-readable message safe to expose to API consumers. */
  message: string;
  /** Optional: the specific API field that caused the error. */
  field?: string;
  /** Optional: request correlation id for log tracing. */
  requestId?: string;
};

export type OracleErrorMapping = {
  oracleCode: string;
  bridgeError: BridgeApiError;
};

export { translateOracleError } from "./translator.js";
