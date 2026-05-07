import type { OracleConnectionRegistry } from "../connections/index.js";
import type { OracleCapabilityDetector } from "../connections/oracle-capabilities.js";
import type { OracleSchemaInspector, StoredOracleSchemaSnapshot } from "../oracleInspector/index.js";
import type { DraftContractService, StoredPublishedContract } from "../contracts/draft-contracts.js";
import type { ContractPublishService } from "../contracts/publish-contracts.js";
import type { ContractCompiler } from "../compiler/index.js";
import type { ContractCache } from "../contracts/contract-cache.js";
import type { OracleConnectorAdapter } from "../connections/oracle-adapter.js";
import type { PermissionChecker } from "../runtime/permissions.js";
import type { AuditLogger } from "../audit/index.js";
import type { OracleBindTypeRegistry } from "../runtime/oracle-helpers.js";
import type { OraclePaginationStrategy } from "../contracts/index.js";

export type StoredCompilerDiagnostic = {
  id: string;
  apiContractDraftId: string;
  code: string;
  severity: string;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
};

export type StoredAuditLog = {
  id: string;
  eventType: string;
  actor: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: Date;
};

export type BridgeAdminStore = {
  oracleSchemaSnapshot: {
    findMany(args?: {
      where?: { apiConnectionId?: string; oracleOwner?: string };
      orderBy?: { capturedAt?: "asc" | "desc" };
    }): Promise<StoredOracleSchemaSnapshot[]>;
    findUnique(args: { where: { id: string } }): Promise<StoredOracleSchemaSnapshot | null>;
  };
  publishedContract: {
    findMany(args?: {
      where?: { status?: string };
      orderBy?: { version?: "asc" | "desc" };
    }): Promise<StoredPublishedContract[]>;
    findUnique(args: { where: { id: string } }): Promise<StoredPublishedContract | null>;
  };
  compilerDiagnostic: {
    findMany(args?: {
      where?: { apiContractDraftId?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }): Promise<StoredCompilerDiagnostic[]>;
  };
  auditLog: {
    findMany(args?: {
      where?: { eventType?: string };
      orderBy?: { occurredAt?: "asc" | "desc" };
      take?: number;
    }): Promise<StoredAuditLog[]>;
  };
};

export type BridgeHttpContext = {
  connections: OracleConnectionRegistry;
  inspector: OracleSchemaInspector;
  capabilityDetector: OracleCapabilityDetector;
  drafts: DraftContractService;
  publisher: ContractPublishService;
  compiler: ContractCompiler;
  cache: ContractCache;
  adapter: OracleConnectorAdapter;
  permissions: PermissionChecker;
  oracleBindTypes: OracleBindTypeRegistry;
  paginationStrategy?: OraclePaginationStrategy;
  audit?: AuditLogger;
  store: BridgeAdminStore;
};
