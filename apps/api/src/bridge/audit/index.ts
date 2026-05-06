import type { ResolvedApiContract } from "../contracts/index.js";

export type AuditEventType =
  | "contract.draft.created"
  | "contract.draft.updated"
  | "contract.compiled"
  | "contract.published"
  | "contract.deprecated"
  | "contract.retired"
  | "runtime.request.received"
  | "runtime.request.succeeded"
  | "runtime.request.failed"
  | "runtime.validation.failed"
  | "runtime.oracle.error"
  | "runtime.plsql.executed"
  | "runtime.sys_refcursor.read"
  | "runtime.optimistic_lock.conflict"
  | "runtime.schema_mismatch";

export type AuditEvent = {
  id: string;
  type: AuditEventType;
  occurredAt: Date;
  actor?: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogger = {
  log(event: Omit<AuditEvent, "id" | "occurredAt">): void;
};

export type RuntimeAuditStatus = "received" | "succeeded" | "failed";

export type RuntimeAuditMetadata = {
  request_id?: string;
  user_id?: string;
  resource: string;
  endpoint: string;
  contract_version: number;
  operation: string;
  oracle_owner: string;
  oracle_object_name?: string;
  oracle_object_type: string;
  oracle_package_name?: string;
  oracle_procedure_name?: string;
  oracle_error_code?: string;
  status: RuntimeAuditStatus;
  duration_ms: number;
  timestamp: string;
  result_count?: number;
  code?: string;
};

export type ContractAuditMetadata = {
  resource: string;
  endpoint: string;
  contract_version?: number;
  actor?: string;
  status?: string;
  timestamp: string;
};

export function buildRuntimeAuditMetadata(input: {
  contract: ResolvedApiContract;
  operation: string;
  status: RuntimeAuditStatus;
  startedAt: number;
  requestId?: string;
  userId?: string;
  oracleErrorCode?: string;
  resultCount?: number;
  code?: string;
}): RuntimeAuditMetadata {
  const { contract } = input;
  const isProcedureBacked = contract.source.type === "package" || contract.source.type === "procedure";
  return {
    request_id: input.requestId,
    user_id: input.userId,
    resource: contract.resource,
    endpoint: contract.endpoint,
    contract_version: contract.version,
    operation: input.operation,
    oracle_owner: contract.source.owner,
    oracle_object_name: contract.source.name ?? contract.source.packageName ?? contract.source.procedureName,
    oracle_object_type: contract.source.type,
    oracle_package_name: isProcedureBacked ? contract.source.packageName : undefined,
    oracle_procedure_name: isProcedureBacked ? (contract.source.procedureName ?? contract.source.name) : undefined,
    oracle_error_code: input.oracleErrorCode,
    status: input.status,
    duration_ms: Math.max(0, Date.now() - input.startedAt),
    timestamp: new Date().toISOString(),
    result_count: input.resultCount,
    code: input.code
  };
}

export function buildContractAuditMetadata(input: {
  resource: string;
  endpoint: string;
  contractVersion?: number;
  actor?: string;
  status?: string;
}): ContractAuditMetadata {
  return {
    resource: input.resource,
    endpoint: input.endpoint,
    contract_version: input.contractVersion,
    actor: input.actor,
    status: input.status,
    timestamp: new Date().toISOString()
  };
}

export function extractOracleErrorCode(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/ORA-\d{5}/);
  return match?.[0];
}

export function isSchemaMismatchCode(code: string | undefined): boolean {
  return code === "ORA-00942" || code === "ORA-00904";
}
