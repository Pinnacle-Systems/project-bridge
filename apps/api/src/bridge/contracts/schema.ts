import type {
  ApiFieldMapping,
  ApiFieldType,
  ContractOperation,
  ContractStatus,
  OraclePaginationStrategy,
  OracleScalarType,
  OracleSourceObjectType,
  OracleTransformer,
  ProcedureParamDirection,
  ResolvedApiContract,
  SchemaHealthStatus
} from "./index.js";

export type ContractValidationIssue = {
  path: string;
  message: string;
};

export type ContractValidationResult =
  | {
      success: true;
      data: ResolvedApiContract;
      issues: [];
    }
  | {
      success: false;
      issues: ContractValidationIssue[];
    };

export const resolvedApiContractSchema = {
  name: "ResolvedApiContract",
  version: 1,
  required: ["resource", "version", "endpoint", "status", "source", "operations", "fields", "runtime"]
} as const;

const sourceTypes = ["table", "view", "package", "procedure"] as const satisfies readonly OracleSourceObjectType[];
const oracleTypes = [
  "varchar2",
  "nvarchar2",
  "char",
  "nchar",
  "number",
  "date",
  "timestamp",
  "clob",
  "blob",
  "raw",
  "boolean",
  "sys_refcursor"
] as const satisfies readonly OracleScalarType[];
const apiFieldTypes = [
  "string",
  "number",
  "decimal",
  "integer",
  "boolean",
  "date",
  "date-time",
  "object",
  "array",
  "binary"
] as const satisfies readonly ApiFieldType[];
const operations = ["read", "list", "create", "update", "delete"] as const satisfies readonly ContractOperation[];
const statuses = ["active", "deprecated", "retired"] as const satisfies readonly Exclude<ContractStatus, "draft">[];
const paginationStrategies = ["offsetFetch", "rownum"] as const satisfies readonly OraclePaginationStrategy[];
const procedureDirections = ["in", "out", "inout", "return"] as const satisfies readonly ProcedureParamDirection[];
const schemaHealthStatuses = [
  "healthy",
  "drift_detected",
  "invalid",
  "unknown"
] as const satisfies readonly SchemaHealthStatus[];

export function validateResolvedApiContract(value: unknown): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      success: false,
      issues: [{ path: "$", message: "ResolvedApiContract must be an object." }]
    };
  }

  requireString(value, "resource", issues);
  requireInteger(value, "version", issues);
  requireString(value, "endpoint", issues);
  requireEnum(value, "status", statuses, issues);
  validateSource(value.source, "source", issues);
  validateOperations(value.operations, "operations", issues);
  validateFields(value.fields, "fields", issues, getSourceType(value.source));
  validateRuntime(value.runtime, "runtime", issues);
  validateSchemaHealth(value.schemaHealth, "schemaHealth", issues);

  if ("publishedAt" in value && !isDateLike(value.publishedAt)) {
    issues.push({ path: "publishedAt", message: "publishedAt must be a Date or ISO date string." });
  }
  if ("publishedBy" in value && value.publishedBy !== undefined && !isNonEmptyString(value.publishedBy)) {
    issues.push({ path: "publishedBy", message: "publishedBy must be a non-empty string when provided." });
  }

  if ("pagination" in value && value.pagination !== undefined) {
    validatePagination(value.pagination, "pagination", issues);
  }
  if ("optimisticLocking" in value && value.optimisticLocking !== undefined) {
    validateOptimisticLocking(value.optimisticLocking, "optimisticLocking", issues);
  }
  if ("procedureParams" in value && value.procedureParams !== undefined) {
    validateProcedureParams(value.procedureParams, "procedureParams", issues);
  }
  if ("sysRefCursor" in value && value.sysRefCursor !== undefined) {
    validateSysRefCursor(value.sysRefCursor, "sysRefCursor", issues);
  }

  validateSysRefCursorRequirement(value, issues);

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return { success: true, data: value as ResolvedApiContract, issues: [] };
}

export function isResolvedApiContract(value: unknown): value is ResolvedApiContract {
  return validateResolvedApiContract(value).success;
}

function validateSource(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "source is required." });
    return;
  }

  requireString(value, "database", issues, path);
  requireString(value, "owner", issues, path);
  requireEnum(value, "type", sourceTypes, issues, path);

  if (value.type === "table" || value.type === "view") {
    requireString(value, "name", issues, path);
  }

  if (value.type === "package") {
    requireString(value, "packageName", issues, path);
    requireString(value, "procedureName", issues, path);
  }

  if (value.type === "procedure") {
    if (!isNonEmptyString(value.procedureName) && !isNonEmptyString(value.name)) {
      issues.push({ path: `${path}.procedureName`, message: "procedure sources require procedureName or name." });
    }
  }
}

function validateOperations(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: "operations must be a non-empty array." });
    return;
  }

  value.forEach((operation, index) => {
    const operationPath = `${path}[${index}]`;
    if (!isRecord(operation)) {
      issues.push({ path: operationPath, message: "operation policy must be an object." });
      return;
    }
    requireEnum(operation, "operation", operations, issues, operationPath);
    requireBoolean(operation, "enabled", issues, operationPath);
    validateStringArray(operation.allowedFields, `${operationPath}.allowedFields`, issues);
    validateStringArray(operation.requiredFields, `${operationPath}.requiredFields`, issues);
  });
}

function validateFields(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
  sourceType?: OracleSourceObjectType
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "fields is required and must be an array." });
    return;
  }

  if ((sourceType === "table" || sourceType === "view") && value.length === 0) {
    issues.push({ path, message: "table and view contracts require at least one field mapping." });
  }

  value.forEach((field, index) => validateField(field, `${path}[${index}]`, issues, sourceType));
}

function validateField(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
  sourceType?: OracleSourceObjectType
): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "field mapping must be an object." });
    return;
  }

  requireString(value, "apiField", issues, path);
  requireEnum(value, "apiType", apiFieldTypes, issues, path);
  requireEnum(value, "oracleType", oracleTypes, issues, path);

  if ((sourceType === "table" || sourceType === "view") && !isNonEmptyString(value.dbColumn)) {
    issues.push({ path: `${path}.dbColumn`, message: "dbColumn is required for table and view field mappings." });
  }

  validateOptionalBoolean(value, "nullable", issues, path);
  validateOptionalBoolean(value, "readOnly", issues, path);
  validateOptionalBoolean(value, "writeOnly", issues, path);
  validateOptionalBoolean(value, "required", issues, path);

  if ("transformers" in value && value.transformers !== undefined) {
    validateTransformers(value.transformers, `${path}.transformers`, issues);
  }
}

function validateTransformers(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "transformers must be an array." });
    return;
  }

  value.forEach((transformer, index) => validateTransformer(transformer, `${path}[${index}]`, issues));
}

function validateTransformer(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "transformer must be an object." });
    return;
  }

  if (value.kind === "booleanMapping") {
    if (!["char", "number", "varchar2"].includes(String(value.oracleType))) {
      issues.push({ path: `${path}.oracleType`, message: "booleanMapping oracleType must be char, number, or varchar2." });
    }
    if (!isStringOrNumber(value.trueValue)) {
      issues.push({ path: `${path}.trueValue`, message: "booleanMapping trueValue must be a string or number." });
    }
    if (!isStringOrNumber(value.falseValue)) {
      issues.push({ path: `${path}.falseValue`, message: "booleanMapping falseValue must be a string or number." });
    }
    if (value.trueValue === value.falseValue) {
      issues.push({ path, message: "booleanMapping trueValue and falseValue must be different." });
    }
    return;
  }

  if (value.kind === "trimRight") {
    if (!["char", "nchar", "varchar2", "nvarchar2"].includes(String(value.oracleType))) {
      issues.push({
        path: `${path}.oracleType`,
        message: "trimRight oracleType must be char, nchar, varchar2, or nvarchar2."
      });
    }
    return;
  }

  issues.push({ path: `${path}.kind`, message: "transformer kind must be booleanMapping or trimRight." });
}

function validateRuntime(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "runtime metadata is required." });
    return;
  }

  requireString(value, "cacheKey", issues, path);
  requireString(value, "schemaVersion", issues, path);
  if ("loadedAt" in value && value.loadedAt !== undefined && !isDateLike(value.loadedAt)) {
    issues.push({ path: `${path}.loadedAt`, message: "loadedAt must be a Date or ISO date string." });
  }
}

function validateSchemaHealth(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "schemaHealth is required." });
    return;
  }

  requireEnum(value, "status", schemaHealthStatuses, issues, path);
  if ("checkedAt" in value && value.checkedAt !== undefined && !isDateLike(value.checkedAt)) {
    issues.push({ path: `${path}.checkedAt`, message: "checkedAt must be a Date or ISO date string." });
  }
  validateStringArray(value.findings, `${path}.findings`, issues);
}

function validatePagination(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "pagination must be an object." });
    return;
  }

  requirePositiveInteger(value, "defaultLimit", issues, path);
  requirePositiveInteger(value, "maxLimit", issues, path);
  requireEnum(value, "strategy", paginationStrategies, issues, path);

  if (
    typeof value.defaultLimit === "number" &&
    typeof value.maxLimit === "number" &&
    value.defaultLimit > value.maxLimit
  ) {
    issues.push({ path, message: "defaultLimit must be less than or equal to maxLimit." });
  }
}

function validateOptimisticLocking(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "optimisticLocking must be an object." });
    return;
  }

  requireBoolean(value, "enabled", issues, path);
  requireString(value, "apiField", issues, path);
  requireString(value, "dbColumn", issues, path);
  if (!["number", "date", "timestamp"].includes(String(value.oracleType))) {
    issues.push({ path: `${path}.oracleType`, message: "optimisticLocking oracleType must be number, date, or timestamp." });
  }
}

function validateProcedureParams(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "procedureParams must be an array." });
    return;
  }

  value.forEach((param, index) => {
    const paramPath = `${path}[${index}]`;
    if (!isRecord(param)) {
      issues.push({ path: paramPath, message: "procedure parameter mapping must be an object." });
      return;
    }
    requireString(param, "paramName", issues, paramPath);
    requireEnum(param, "direction", procedureDirections, issues, paramPath);
    requireEnum(param, "oracleType", oracleTypes, issues, paramPath);
    validateOptionalBoolean(param, "required", issues, paramPath);
  });
}

function validateSysRefCursor(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "sysRefCursor must be an object." });
    return;
  }

  requireString(value, "paramName", issues, path);
  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    issues.push({ path: `${path}.fields`, message: "SYS_REFCURSOR mapping requires at least one output field." });
    return;
  }
  value.fields.forEach((field, index) => validateField(field, `${path}.fields[${index}]`, issues, "view"));
}

function validateSysRefCursorRequirement(value: Record<string, unknown>, issues: ContractValidationIssue[]): void {
  if (!Array.isArray(value.procedureParams)) {
    return;
  }

  const cursorParams = value.procedureParams.filter(
    (param): param is Record<string, unknown> =>
      isRecord(param) &&
      param.oracleType === "sys_refcursor" &&
      (param.direction === "out" || param.direction === "return")
  );

  for (const cursorParam of cursorParams) {
    if (!isRecord(value.sysRefCursor)) {
      issues.push({
        path: "sysRefCursor",
        message: "SYS_REFCURSOR procedure params require a sysRefCursor output mapping."
      });
      continue;
    }
    if (value.sysRefCursor.paramName !== cursorParam.paramName) {
      issues.push({
        path: "sysRefCursor.paramName",
        message: "SYS_REFCURSOR mapping paramName must match the cursor procedure parameter."
      });
    }
  }
}

function getSourceType(value: unknown): OracleSourceObjectType | undefined {
  if (!isRecord(value) || !sourceTypes.includes(value.type as OracleSourceObjectType)) {
    return undefined;
  }
  return value.type as OracleSourceObjectType;
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  issues: ContractValidationIssue[],
  basePath = ""
): void {
  if (!isNonEmptyString(value[key])) {
    issues.push({ path: joinPath(basePath, key), message: `${key} must be a non-empty string.` });
  }
}

function requireBoolean(
  value: Record<string, unknown>,
  key: string,
  issues: ContractValidationIssue[],
  basePath = ""
): void {
  if (typeof value[key] !== "boolean") {
    issues.push({ path: joinPath(basePath, key), message: `${key} must be a boolean.` });
  }
}

function validateOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
  issues: ContractValidationIssue[],
  basePath = ""
): void {
  if (key in value && value[key] !== undefined && typeof value[key] !== "boolean") {
    issues.push({ path: joinPath(basePath, key), message: `${key} must be a boolean when provided.` });
  }
}

function requireInteger(
  value: Record<string, unknown>,
  key: string,
  issues: ContractValidationIssue[],
  basePath = ""
): void {
  if (!Number.isInteger(value[key])) {
    issues.push({ path: joinPath(basePath, key), message: `${key} must be an integer.` });
  }
}

function requirePositiveInteger(
  value: Record<string, unknown>,
  key: string,
  issues: ContractValidationIssue[],
  basePath = ""
): void {
  if (!Number.isInteger(value[key]) || Number(value[key]) <= 0) {
    issues.push({ path: joinPath(basePath, key), message: `${key} must be a positive integer.` });
  }
}

function requireEnum<T extends readonly string[]>(
  value: Record<string, unknown>,
  key: string,
  allowed: T,
  issues: ContractValidationIssue[],
  basePath = ""
): void {
  if (!allowed.includes(value[key] as T[number])) {
    issues.push({ path: joinPath(basePath, key), message: `${key} must be one of: ${allowed.join(", ")}.` });
  }
}

function validateStringArray(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    issues.push({ path, message: "value must be an array of non-empty strings when provided." });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringOrNumber(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function isDateLike(value: unknown): boolean {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function joinPath(basePath: string, key: string): string {
  return basePath ? `${basePath}.${key}` : key;
}
