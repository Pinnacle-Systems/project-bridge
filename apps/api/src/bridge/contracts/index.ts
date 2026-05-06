export type OracleSourceObjectType = "table" | "view" | "package" | "procedure";

export type OracleScalarType =
  | "varchar2"
  | "nvarchar2"
  | "char"
  | "nchar"
  | "number"
  | "date"
  | "timestamp"
  | "clob"
  | "blob"
  | "raw"
  | "boolean"
  | "sys_refcursor";

export type ApiFieldType =
  | "string"
  | "number"
  | "decimal"
  | "integer"
  | "boolean"
  | "date"
  | "date-time"
  | "object"
  | "array"
  | "binary";

export type ContractOperation = "read" | "list" | "create" | "update" | "delete";

export type ContractStatus = "draft" | "active" | "deprecated" | "retired";

export type OraclePaginationStrategy = "offsetFetch" | "rownum";

export type OracleSource = {
  database: string;
  owner: string;
  type: OracleSourceObjectType;
  name?: string;
  packageName?: string;
  procedureName?: string;
};

export type SequenceIdGeneration = {
  strategy: "sequence";
  sequenceName: string;
};

export type TriggerIdGeneration = {
  strategy: "trigger";
  returningColumn?: string;
};

export type IdGenerationConfig = SequenceIdGeneration | TriggerIdGeneration;

export type ApiFieldMapping = {
  apiField: string;
  apiType: ApiFieldType;
  dbColumn?: string;
  oracleType: OracleScalarType;
  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  required?: boolean;
  transformers?: OracleTransformer[];
};

export type OperationPolicy = {
  operation: ContractOperation;
  enabled: boolean;
  permission?: string;
  allowedFields?: string[];
  requiredFields?: string[];
};

export type BooleanMappingTransformer = {
  kind: "booleanMapping";
  oracleType: Extract<OracleScalarType, "char" | "number" | "varchar2">;
  trueValue: string | number;
  falseValue: string | number;
};

export type TrimRightTransformer = {
  kind: "trimRight";
  oracleType: Extract<OracleScalarType, "char" | "nchar" | "varchar2" | "nvarchar2">;
};

export type OracleTransformer = BooleanMappingTransformer | TrimRightTransformer;

export type OptimisticLockingConfig = {
  enabled: boolean;
  apiField: string;
  dbColumn: string;
  oracleType: Extract<OracleScalarType, "number" | "date" | "timestamp">;
};

export type PaginationConfig = {
  defaultLimit: number;
  maxLimit: number;
  strategy: OraclePaginationStrategy;
};

export type FilterConfig = {
  field: string;
  operators?: Array<"eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "like" | "in">;
};

export type SortConfig = {
  field: string;
  directions?: Array<"asc" | "desc">;
};

export type ProcedureParamDirection = "in" | "out" | "inout" | "return";

export type ProcedureParamMapping = {
  paramName: string;
  direction: ProcedureParamDirection;
  apiField?: string;
  oracleType: OracleScalarType;
  required?: boolean;
};

export type SysRefCursorMapping = {
  paramName: string;
  fields: ApiFieldMapping[];
};

export type ErrorMapping = {
  oracleCode: string;
  apiCode: string;
  httpStatus: number;
  message: string;
};

export type SchemaHealthStatus = "healthy" | "drift_detected" | "invalid" | "unknown";

export type SchemaHealth = {
  status: SchemaHealthStatus;
  checkedAt?: Date;
  oracleObjectStatus?: "valid" | "invalid" | "unknown";
  findings?: string[];
};

export type DraftApiContract = {
  resource: string;
  endpoint: string;
  source: OracleSource;
  fields: ApiFieldMapping[];
  operations: OperationPolicy[];
  idGeneration?: IdGenerationConfig;
  pagination?: PaginationConfig;
  filters?: FilterConfig[];
  sorts?: SortConfig[];
  optimisticLocking?: OptimisticLockingConfig;
  procedureParams?: ProcedureParamMapping[];
  sysRefCursor?: SysRefCursorMapping;
  errorMappings?: ErrorMapping[];
};

export const SCHEMA_VERSION = "1" as const;

export type RuntimeContractMetadata = {
  loadedAt?: Date;
  cacheKey: string;
  schemaVersion: string;
};

export type ResolvedApiContract = DraftApiContract & {
  id: string;
  version: number;
  status: Exclude<ContractStatus, "draft">;
  publishedAt: Date;
  publishedBy?: string;
  schemaHealth: SchemaHealth;
  runtime: RuntimeContractMetadata;
};

export type BridgeContractOperation = ContractOperation;
export type BridgeContractSource = OracleSource;
export type BridgeContractDraft = DraftApiContract;
export type PublishedBridgeContract = ResolvedApiContract;

export * from "./schema.js";
export * from "./draft-contracts.js";
export * from "./publish-contracts.js";
export * from "./contract-cache.js";
