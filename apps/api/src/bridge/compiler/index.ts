import {
  SCHEMA_VERSION,
  validateResolvedApiContract,
  type ApiFieldMapping,
  type DraftApiContract,
  type PaginationConfig,
  type ResolvedApiContract
} from "../contracts/index.js";
import type {
  OracleInspectedColumn,
  OracleInspectedObject,
  OracleInspectedProgramUnit,
  OracleSchemaSnapshot
} from "../oracleInspector/index.js";

export type ContractCompilerDiagnosticSeverity = "info" | "warning" | "error";

export type ContractCompilerDiagnostic = {
  code: string;
  message: string;
  severity: ContractCompilerDiagnosticSeverity;
  path?: string;
};

export type ContractCompileResult = {
  contract?: ResolvedApiContract;
  diagnostics: ContractCompilerDiagnostic[];
};

export type ContractCompilerStore = {
  apiConnection: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; paginationStrategy?: string | null } | null>;
  };
  oracleSchemaSnapshot: {
    findFirst(args: {
      where: {
        apiConnectionId: string;
        oracleOwner: string;
      };
      orderBy: { capturedAt: "desc" };
    }): Promise<{ snapshotData: OracleSchemaSnapshot } | null>;
  };
};

export type CompileDraftContractInput = {
  apiConnectionId: string;
  draft: DraftApiContract;
  version?: number;
  compiledBy?: string;
};

export type ContractCompiler = {
  compile(input: CompileDraftContractInput): Promise<ContractCompileResult>;
};

export function createOracleAwareContractCompiler(store: ContractCompilerStore): ContractCompiler {
  return {
    async compile(input) {
      const diagnostics: ContractCompilerDiagnostic[] = [];
      const connection = await store.apiConnection.findUnique({ where: { id: input.apiConnectionId } });
      if (!connection) {
        diagnostics.push(error("CONNECTION_NOT_FOUND", "Oracle connection does not exist.", "apiConnectionId"));
        return { diagnostics };
      }

      const owner = input.draft.source?.owner?.toUpperCase();
      const snapshotRecord = owner
        ? await store.oracleSchemaSnapshot.findFirst({
            where: {
              apiConnectionId: input.apiConnectionId,
              oracleOwner: owner
            },
            orderBy: { capturedAt: "desc" }
          })
        : null;

      if (!snapshotRecord) {
        diagnostics.push(error("OWNER_SNAPSHOT_NOT_FOUND", "Owner was not found in the latest schema snapshots.", "source.owner"));
        return { diagnostics };
      }

      const sourceObject = isTableOrViewDraft(input.draft)
        ? validateSourceObject(input.draft, snapshotRecord.snapshotData, diagnostics)
        : undefined;
      const programUnit = isProcedureBackedDraft(input.draft)
        ? validateProcedureSource(input.draft, snapshotRecord.snapshotData, diagnostics)
        : undefined;

      if (isTableOrViewDraft(input.draft)) {
        validateFields(input.draft, sourceObject, diagnostics);
        validateReadListOperations(input.draft, diagnostics);
      } else {
        validateProcedureOperations(input.draft, diagnostics);
        validateProcedureParams(input.draft, programUnit, diagnostics);
        validateSysRefCursorUsage(input.draft, programUnit, diagnostics);
        validateProcedureOptimisticLocking(input.draft, diagnostics);
      }
      validateFieldReferences(input.draft, diagnostics);

      const pagination = input.draft.pagination ?? defaultPagination(connection.paginationStrategy);
      const resolvedFields = sourceObject
        ? normalizeResolvedFields(input.draft, sourceObject, diagnostics)
        : input.draft.fields;
      const draftWithDefaults: DraftApiContract = {
        ...input.draft,
        source: {
          ...input.draft.source,
          owner
        },
        fields: resolvedFields,
        pagination
      };

      if (hasErrors(diagnostics)) {
        return { diagnostics };
      }

      const resolved: ResolvedApiContract = {
        ...draftWithDefaults,
        id: `${input.apiConnectionId}:${input.draft.resource}:${input.version ?? 1}`,
        version: input.version ?? 1,
        status: "active",
        publishedAt: new Date(),
        publishedBy: input.compiledBy,
        schemaHealth: {
          status: "healthy",
          checkedAt: new Date(),
          oracleObjectStatus:
            sourceObject?.objectStatus === "VALID" || programUnit?.objectStatus === "VALID" ? "valid" : "unknown"
        },
        runtime: {
          cacheKey: `${input.draft.endpoint}:v${input.version ?? 1}`,
          schemaVersion: SCHEMA_VERSION
        }
      };

      const validation = validateResolvedApiContract(resolved);
      if (!validation.success) {
        diagnostics.push(
          ...validation.issues.map((issue) =>
            error("RESOLVED_CONTRACT_SCHEMA_INVALID", issue.message, issue.path)
          )
        );
        return { diagnostics };
      }

      diagnostics.push({
        code: "CONTRACT_COMPILED",
        message: "Draft contract compiled successfully.",
        severity: "info"
      });
      return { contract: validation.data, diagnostics };
    }
  };
}

function validateSourceObject(
  draft: DraftApiContract,
  snapshot: OracleSchemaSnapshot,
  diagnostics: ContractCompilerDiagnostic[]
): OracleInspectedObject | undefined {
  const expectedType = draft.source.type.toUpperCase();
  const objectName = draft.source.name?.toUpperCase();
  const sourceObject = snapshot.objects.find(
    (object) =>
      object.owner.toUpperCase() === draft.source.owner.toUpperCase() &&
      object.objectName.toUpperCase() === objectName &&
      object.objectType === expectedType
  );

  if (!sourceObject) {
    diagnostics.push(error("SOURCE_OBJECT_NOT_FOUND", "Source table/view does not exist in the latest schema snapshot.", "source.name"));
    return undefined;
  }

  if (sourceObject.objectStatus !== "VALID") {
    diagnostics.push(error("SOURCE_OBJECT_INVALID", "Source table/view status is not VALID.", "source.name"));
  }

  return sourceObject;
}

function validateProcedureSource(
  draft: DraftApiContract,
  snapshot: OracleSchemaSnapshot,
  diagnostics: ContractCompilerDiagnostic[]
): OracleInspectedProgramUnit | undefined {
  const packageName = draft.source.type === "package" ? draft.source.packageName?.toUpperCase() : null;
  const procedureName = (draft.source.procedureName ?? draft.source.name)?.toUpperCase();

  if (draft.source.type === "package" && !packageName) {
    diagnostics.push(error("PACKAGE_NAME_REQUIRED", "Package-backed contracts require packageName.", "source.packageName"));
    return undefined;
  }
  if (!procedureName) {
    diagnostics.push(error("PROCEDURE_NAME_REQUIRED", "Procedure-backed contracts require procedureName or name.", "source.procedureName"));
    return undefined;
  }

  if (packageName && !snapshot.programUnits.some((unit) => unit.packageName?.toUpperCase() === packageName)) {
    diagnostics.push(error("PACKAGE_NOT_FOUND", "Package does not exist in the latest schema snapshot.", "source.packageName"));
    return undefined;
  }

  const programUnit = snapshot.programUnits.find(
    (unit) =>
      unit.owner.toUpperCase() === draft.source.owner.toUpperCase() &&
      (unit.packageName?.toUpperCase() ?? null) === packageName &&
      unit.name.toUpperCase() === procedureName
  );

  if (!programUnit) {
    diagnostics.push(error("PROCEDURE_NOT_FOUND", "Procedure/function does not exist in the latest schema snapshot.", "source.procedureName"));
    return undefined;
  }

  if (programUnit.objectStatus !== "VALID") {
    diagnostics.push(error("PROCEDURE_OBJECT_INVALID", "Procedure/package object status is not VALID.", "source.procedureName"));
  }

  return programUnit;
}

function validateFields(
  draft: DraftApiContract,
  sourceObject: OracleInspectedObject | undefined,
  diagnostics: ContractCompilerDiagnostic[]
): void {
  const apiFields = new Set<string>();
  const dbColumns = new Map(sourceObject?.columns.map((column) => [column.name.toUpperCase(), column]) ?? []);

  draft.fields.forEach((field, index) => {
    if (apiFields.has(field.apiField)) {
      diagnostics.push(error("DUPLICATE_API_FIELD", `API field '${field.apiField}' is duplicated.`, `fields[${index}].apiField`));
    }
    apiFields.add(field.apiField);

    const column = field.dbColumn ? dbColumns.get(field.dbColumn.toUpperCase()) : undefined;
    if (!field.dbColumn || !column) {
      diagnostics.push(error("MAPPED_COLUMN_NOT_FOUND", `Mapped dbColumn '${field.dbColumn ?? ""}' does not exist.`, `fields[${index}].dbColumn`));
      return;
    }

    validateTypeCompatibility(field, column, index, draft.source.type, diagnostics);
  });
}

function normalizeResolvedFields(
  draft: DraftApiContract,
  sourceObject: OracleInspectedObject,
  diagnostics: ContractCompilerDiagnostic[]
): ApiFieldMapping[] {
  const columns = new Map(sourceObject.columns.map((column) => [column.name.toUpperCase(), column]));

  return draft.fields.map((field, index) => {
    const column = field.dbColumn ? columns.get(field.dbColumn.toUpperCase()) : undefined;
    if (!column) {
      return field;
    }

    if (
      column.oracleType.toUpperCase() === "CHAR" &&
      field.apiType === "string" &&
      !field.transformers?.some((transformer) => transformer.kind === "trimRight")
    ) {
      diagnostics.push({
        code: "TRIM_RIGHT_DEFAULTED",
        message: `CHAR field '${field.apiField}' defaulted to trimRight transformer.`,
        path: `fields[${index}].transformers`,
        severity: "info"
      });
      return {
        ...field,
        transformers: [
          ...(field.transformers ?? []),
          {
            kind: "trimRight",
            oracleType: "char"
          }
        ]
      };
    }

    return field;
  });
}

function validateTypeCompatibility(
  field: ApiFieldMapping,
  column: OracleInspectedColumn,
  index: number,
  sourceType: DraftApiContract["source"]["type"],
  diagnostics: ContractCompilerDiagnostic[]
): void {
  const oracleType = column.oracleType.toUpperCase();

  if (oracleType === "SYS_REFCURSOR" || oracleType === "REF CURSOR") {
    if (sourceType === "table" || sourceType === "view") {
      diagnostics.push(error("SYS_REFCURSOR_TABLE_FIELD_INVALID", "SYS_REFCURSOR fields are valid only for procedure-backed read outputs.", `fields[${index}].oracleType`));
    }
    return;
  }

  if (field.apiType === "boolean") {
    validateBooleanField(field, column, index, diagnostics);
    return;
  }

  if (oracleType === "VARCHAR2" || oracleType === "NVARCHAR2" || oracleType === "CHAR" || oracleType === "NCHAR") {
    if (field.apiType !== "string") {
      diagnostics.push(error("ORACLE_TYPE_INCOMPATIBLE", `${oracleType} must map to API string unless a booleanMapping transformer is used.`, `fields[${index}].apiType`));
    }
    validateTrimRight(field, column, index, diagnostics);
    return;
  }

  if (oracleType === "NUMBER") {
    if (!["integer", "decimal", "number"].includes(field.apiType)) {
      diagnostics.push(error("ORACLE_TYPE_INCOMPATIBLE", "NUMBER must map to integer, decimal, or number unless a booleanMapping transformer is used.", `fields[${index}].apiType`));
    }
    return;
  }

  if (oracleType === "DATE" || oracleType.startsWith("TIMESTAMP")) {
    if (field.apiType !== "date-time") {
      diagnostics.push(error("ORACLE_TYPE_INCOMPATIBLE", `${oracleType} must map to API date-time.`, `fields[${index}].apiType`));
    }
  }
}

function validateBooleanField(
  field: ApiFieldMapping,
  column: OracleInspectedColumn,
  index: number,
  diagnostics: ContractCompilerDiagnostic[]
): void {
  const oracleType = column.oracleType.toUpperCase();
  const booleanCandidate =
    (oracleType === "NUMBER" && column.precision === 1 && (column.scale ?? 0) === 0) ||
    ((oracleType === "CHAR" || oracleType === "VARCHAR2" || oracleType === "NCHAR" || oracleType === "NVARCHAR2") &&
      (column.charLength === 1 || column.dataLength === 1));

  const booleanMapping = field.transformers?.find((transformer) => transformer.kind === "booleanMapping");
  if (!booleanCandidate || !booleanMapping) {
    diagnostics.push(error("BOOLEAN_MAPPING_REQUIRED", "Boolean API fields require NUMBER(1), CHAR(1), or VARCHAR2(1) plus a booleanMapping transformer.", `fields[${index}].transformers`));
    return;
  }

  if (booleanMapping.trueValue === booleanMapping.falseValue) {
    diagnostics.push(error("BOOLEAN_MAPPING_INVALID", "booleanMapping trueValue and falseValue must be distinct.", `fields[${index}].transformers`));
  }

  if (field.writeOnly !== false && (booleanMapping.trueValue === undefined || booleanMapping.falseValue === undefined)) {
    diagnostics.push(error("BOOLEAN_MAPPING_WRITE_INVALID", "Writable boolean fields require both trueValue and falseValue for DB writes.", `fields[${index}].transformers`));
  }
}

function validateTrimRight(
  field: ApiFieldMapping,
  column: OracleInspectedColumn,
  index: number,
  diagnostics: ContractCompilerDiagnostic[]
): void {
  const trimRight = field.transformers?.find((transformer) => transformer.kind === "trimRight");
  if (!trimRight) {
    return;
  }

  const oracleType = column.oracleType.toUpperCase();
  if (oracleType !== "CHAR" && oracleType !== "NCHAR" && oracleType !== "VARCHAR2" && oracleType !== "NVARCHAR2") {
    diagnostics.push(error("TRIM_RIGHT_INVALID", "trimRight transformer can only apply to CHAR/NCHAR/VARCHAR2/NVARCHAR2 fields.", `fields[${index}].transformers`));
  }
}

function validateReadListOperations(draft: DraftApiContract, diagnostics: ContractCompilerDiagnostic[]): void {
  const readEnabled = draft.operations.some((operation) => operation.operation === "read" && operation.enabled);
  const listEnabled = draft.operations.some((operation) => operation.operation === "list" && operation.enabled);

  if (!readEnabled && !listEnabled) {
    diagnostics.push(error("READ_OR_LIST_REQUIRED", "At least one read or list operation must be enabled.", "operations"));
  }
}

function validateProcedureOperations(draft: DraftApiContract, diagnostics: ContractCompilerDiagnostic[]): void {
  if (!draft.operations.some((operation) => operation.enabled)) {
    diagnostics.push(error("OPERATION_REQUIRED", "At least one operation must be enabled.", "operations"));
  }
}

function validateProcedureParams(
  draft: DraftApiContract,
  programUnit: OracleInspectedProgramUnit | undefined,
  diagnostics: ContractCompilerDiagnostic[]
): void {
  if (!programUnit) {
    return;
  }

  const args = new Map(
    programUnit.arguments
      .filter((argument) => argument.name)
      .map((argument) => [argument.name?.toUpperCase(), argument])
  );

  draft.procedureParams?.forEach((param, index) => {
    const argument = args.get(param.paramName.toUpperCase());
    if (!argument) {
      diagnostics.push(error("PROCEDURE_ARG_NOT_FOUND", `Procedure argument '${param.paramName}' was not found.`, `procedureParams[${index}].paramName`));
      return;
    }

    if (normalizeParamDirection(param.direction) !== argument.direction) {
      diagnostics.push(error("PROCEDURE_ARG_DIRECTION_MISMATCH", `Procedure argument '${param.paramName}' direction does not match.`, `procedureParams[${index}].direction`));
    }

    if (!oracleTypesCompatible(param.oracleType, argument.oracleType)) {
      diagnostics.push(error("PROCEDURE_ARG_TYPE_MISMATCH", `Procedure argument '${param.paramName}' Oracle type does not match.`, `procedureParams[${index}].oracleType`));
    }

    if (argument.direction !== "IN" && !argument.isSysRefCursor && !param.apiField) {
      diagnostics.push(error("OUT_PARAM_RESPONSE_FIELD_REQUIRED", `OUT scalar argument '${param.paramName}' must map to a response apiField.`, `procedureParams[${index}].apiField`));
    }
  });
}

function validateSysRefCursorUsage(
  draft: DraftApiContract,
  programUnit: OracleInspectedProgramUnit | undefined,
  diagnostics: ContractCompilerDiagnostic[]
): void {
  if (!programUnit) {
    return;
  }

  const cursorParams = draft.procedureParams?.filter((param) => normalizeOracleType(param.oracleType) === "SYS_REFCURSOR") ?? [];
  if (cursorParams.length === 0) {
    return;
  }

  const readEnabled = draft.operations.some((operation) => operation.enabled && (operation.operation === "read" || operation.operation === "list"));
  const writeEnabled = draft.operations.some((operation) => operation.enabled && (operation.operation === "create" || operation.operation === "update" || operation.operation === "delete"));

  if (writeEnabled) {
    diagnostics.push(error("SYS_REFCURSOR_WRITE_UNSUPPORTED", "SYS_REFCURSOR is not supported for write operations in this compiler version.", "procedureParams"));
  }
  if (!readEnabled) {
    diagnostics.push(error("SYS_REFCURSOR_READ_REQUIRED", "SYS_REFCURSOR OUT params are allowed only for read/list operations.", "operations"));
  }
  if (!draft.sysRefCursor || draft.sysRefCursor.fields.length === 0) {
    diagnostics.push(error("SYS_REFCURSOR_ROW_MAPPING_REQUIRED", "SYS_REFCURSOR params require rowMapping via sysRefCursor.fields.", "sysRefCursor.fields"));
    return;
  }

  const apiFields = new Set<string>();
  draft.sysRefCursor.fields.forEach((field, index) => {
    if (apiFields.has(field.apiField)) {
      diagnostics.push(error("SYS_REFCURSOR_ROW_FIELD_DUPLICATE", `SYS_REFCURSOR rowMapping apiField '${field.apiField}' is duplicated.`, `sysRefCursor.fields[${index}].apiField`));
    }
    apiFields.add(field.apiField);
  });
}

function validateProcedureOptimisticLocking(
  draft: DraftApiContract,
  diagnostics: ContractCompilerDiagnostic[]
): void {
  if (!draft.optimisticLocking?.enabled) {
    return;
  }

  const updateEnabled = draft.operations.some(
    (operation) =>
      operation.operation === "update" &&
      operation.enabled &&
      operation.mode !== "direct_table"
  );
  if (!updateEnabled) {
    return;
  }

  const hasLockParam = draft.procedureParams?.some(
    (param) =>
      param.apiField === draft.optimisticLocking?.apiField &&
      (param.direction === "in" || param.direction === "inout")
  );
  const hasConflictParam =
    draft.optimisticLocking.conflictApiField !== undefined &&
    draft.procedureParams?.some(
      (param) =>
        param.apiField === draft.optimisticLocking?.conflictApiField &&
        (param.direction === "out" || param.direction === "inout" || param.direction === "return")
    );

  if (!hasLockParam && !hasConflictParam) {
    diagnostics.push(
      error(
        "OPTIMISTIC_LOCKING_PROCEDURE_UNSUPPORTED",
        "Procedure-backed optimistic locking requires a version/timestamp IN param or configured conflict OUT param.",
        "optimisticLocking"
      )
    );
  }
}

function validateFieldReferences(draft: DraftApiContract, diagnostics: ContractCompilerDiagnostic[]): void {
  const mappedFields = new Set(draft.fields.map((field) => field.apiField));

  draft.filters?.forEach((filter, index) => {
    if (!mappedFields.has(filter.field)) {
      diagnostics.push(error("FILTER_FIELD_NOT_MAPPED", `Filter field '${filter.field}' is not mapped.`, `filters[${index}].field`));
    }
  });

  draft.sorts?.forEach((sort, index) => {
    if (!mappedFields.has(sort.field)) {
      diagnostics.push(error("SORT_FIELD_NOT_MAPPED", `Sort field '${sort.field}' is not mapped.`, `sorts[${index}].field`));
    }
  });
}

function defaultPagination(strategy: string | null | undefined): PaginationConfig {
  return {
    defaultLimit: 50,
    maxLimit: 250,
    strategy: strategy === "rownum" ? "rownum" : "offsetFetch"
  };
}

function error(code: string, message: string, path?: string): ContractCompilerDiagnostic {
  return {
    code,
    message,
    path,
    severity: "error"
  };
}

function hasErrors(diagnostics: ContractCompilerDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function isTableOrViewDraft(draft: DraftApiContract): boolean {
  return draft.source.type === "table" || draft.source.type === "view";
}

function isProcedureBackedDraft(draft: DraftApiContract): boolean {
  return draft.source.type === "package" || draft.source.type === "procedure";
}

function normalizeParamDirection(direction: string): "IN" | "OUT" | "IN/OUT" {
  if (direction === "out") {
    return "OUT";
  }
  if (direction === "inout") {
    return "IN/OUT";
  }
  return "IN";
}

function oracleTypesCompatible(configuredType: string, actualType: string): boolean {
  return normalizeOracleType(configuredType) === normalizeOracleType(actualType);
}

function normalizeOracleType(type: string): string {
  const normalized = type.toUpperCase().replace(/\s+/g, "_");
  if (normalized === "REF_CURSOR") {
    return "SYS_REFCURSOR";
  }
  return normalized;
}
