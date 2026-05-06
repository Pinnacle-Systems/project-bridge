export type BridgeErrorCode =
  | "CONTRACT_INVALID"
  | "CONTRACT_NOT_FOUND"
  | "ORACLE_ERROR"
  | "VALIDATION_FAILED"
  | "SCHEMA_DRIFT";

export type BridgeApiError = {
  code: BridgeErrorCode;
  message: string;
  statusCode: number;
  requestId?: string;
};

export type OracleErrorMapping = {
  oracleCode: string;
  bridgeError: BridgeApiError;
};
