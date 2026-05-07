import type { ResolvedApiContract, ApiFieldMapping } from "../contracts/index.js";
import type {
  OracleSchemaSnapshot,
  OracleInspectedObject,
  OracleInspectedProgramUnit
} from "../oracleInspector/index.js";
import type { DriftStatus, DriftFinding, DriftCheckResult } from "./types.js";

export function checkContractDrift(
  contract: ResolvedApiContract,
  snapshot: OracleSchemaSnapshot
): DriftCheckResult {
  const findings: DriftFinding[] = [];
  const { source } = contract;

  if (source.type === "table" || source.type === "view") {
    checkObjectDrift(contract, snapshot, findings);
  }

  if (source.type === "package" || source.type === "procedure") {
    checkProcedureDrift(contract, snapshot, findings);
  }

  if (contract.idGeneration?.strategy === "sequence") {
    checkSequenceDrift(contract, snapshot, findings);
  }

  return {
    contractId: contract.id,
    contractVersion: contract.version,
    oracleOwner: source.owner,
    oracleObject: source.name ?? source.packageName ?? source.procedureName ?? "unknown",
    checkedAt: new Date(),
    status: computeStatus(findings),
    findings
  };
}

// ─── Object (table / view) checks ──────────────────────────────────────────

function checkObjectDrift(
  contract: ResolvedApiContract,
  snapshot: OracleSchemaSnapshot,
  findings: DriftFinding[]
): void {
  const { source } = contract;
  const objectName = source.name!.toUpperCase();
  const expectedType = source.type === "table" ? "TABLE" : "VIEW";

  const obj = snapshot.objects.find(
    o => o.objectName.toUpperCase() === objectName && o.objectType === expectedType
  );

  if (!obj) {
    findings.push({
      severity: "broken",
      category: "object",
      message: `Source ${source.type} '${source.owner}.${objectName}' does not exist in the Oracle schema.`
    });
    return;
  }

  // View / table invalidation (check 2 & 9)
  if (obj.objectStatus === "INVALID") {
    findings.push({
      severity: "broken",
      category: "object",
      message: `Source ${source.type} '${source.owner}.${objectName}' has INVALID status in Oracle.`
    });
  }

  // Column checks (checks 3 & 4)
  for (const field of contract.fields) {
    if (!field.dbColumn) continue;
    checkColumnDrift(field, obj, findings);
  }
}

function checkColumnDrift(
  field: ApiFieldMapping,
  obj: OracleInspectedObject,
  findings: DriftFinding[]
): void {
  const dbColumn = field.dbColumn!.toUpperCase();
  const column = obj.columns.find(c => c.name.toUpperCase() === dbColumn);

  // Check 3: column existence
  if (!column) {
    findings.push({
      severity: "broken",
      category: "column",
      message: `Column '${dbColumn}' (mapped to field '${field.apiField}') no longer exists.`
    });
    return;
  }

  // Check 4: type compatibility — skip for boolean (transformer-mapped to CHAR/NUMBER)
  if (field.oracleType !== "boolean") {
    const expected = field.oracleType.toUpperCase();
    const actual = column.oracleType.toUpperCase();
    if (!isTypeCompatible(expected, actual)) {
      findings.push({
        severity: "broken",
        category: "column",
        message: `Column '${dbColumn}' type mismatch: contract expects ${expected}, Oracle reports ${actual}.`
      });
      return;
    }
  }

  // Check 4: dimension reductions using baseline hints captured at publish time
  const { columnHints: hints } = field;
  if (!hints) return;

  if (hints.charLength !== undefined && column.charLength !== null && column.charLength < hints.charLength) {
    findings.push({
      severity: "warning",
      category: "column",
      message: `Column '${dbColumn}' character length reduced from ${hints.charLength} to ${column.charLength}.`,
      detail: `Data longer than ${column.charLength} characters will be rejected by Oracle.`
    });
  }

  if (hints.dataLength !== undefined && column.dataLength !== null && column.dataLength < hints.dataLength) {
    findings.push({
      severity: "warning",
      category: "column",
      message: `Column '${dbColumn}' byte length reduced from ${hints.dataLength} to ${column.dataLength}.`
    });
  }

  if (hints.precision !== undefined && column.precision !== null && column.precision < hints.precision) {
    findings.push({
      severity: "drifted",
      category: "column",
      message: `Column '${dbColumn}' numeric precision reduced from ${hints.precision} to ${column.precision}.`,
      detail: `Numbers with more than ${column.precision} total digits will be rejected.`
    });
  }

  if (hints.scale !== undefined && column.scale !== null && hints.scale !== column.scale) {
    findings.push({
      severity: "drifted",
      category: "column",
      message: `Column '${dbColumn}' numeric scale changed from ${hints.scale} to ${column.scale}.`
    });
  }

  if (hints.nullable === true && column.nullable === false) {
    findings.push({
      severity: "drifted",
      category: "column",
      message: `Column '${dbColumn}' changed from nullable to NOT NULL.`,
      detail: `Inserting or updating NULL in this column will now fail.`
    });
  }
}

// ─── Sequence check ─────────────────────────────────────────────────────────

function checkSequenceDrift(
  contract: ResolvedApiContract,
  snapshot: OracleSchemaSnapshot,
  findings: DriftFinding[]
): void {
  if (contract.idGeneration?.strategy !== "sequence") return;
  const seqName = contract.idGeneration.sequenceName.toUpperCase();
  const exists = snapshot.sequences.some(s => s.name.toUpperCase() === seqName);
  if (!exists) {
    findings.push({
      severity: "broken",
      category: "sequence",
      message: `Sequence '${contract.source.owner}.${seqName}' used for ID generation does not exist.`
    });
  }
}

// ─── Package / procedure checks ─────────────────────────────────────────────

function checkProcedureDrift(
  contract: ResolvedApiContract,
  snapshot: OracleSchemaSnapshot,
  findings: DriftFinding[]
): void {
  const { source } = contract;
  const packageName = source.packageName?.toUpperCase() ?? null;
  const procedureName = (source.procedureName ?? source.name)?.toUpperCase();

  const unit = snapshot.programUnits.find(u => {
    const uPackage = u.packageName?.toUpperCase() ?? null;
    return uPackage === packageName && u.name.toUpperCase() === procedureName;
  });

  const qualifiedName = packageName
    ? `${source.owner}.${packageName}.${procedureName}`
    : `${source.owner}.${procedureName}`;

  // Check 6: procedure / package existence
  if (!unit) {
    findings.push({
      severity: "broken",
      category: "procedure",
      message: `Procedure '${qualifiedName}' does not exist in Oracle.`
    });
    return;
  }

  // Check 5 & 9: package/procedure invalidation
  if (unit.objectStatus === "INVALID") {
    findings.push({
      severity: "broken",
      category: "procedure",
      message: `Package/procedure '${qualifiedName}' has INVALID status in Oracle.`
    });
  }

  // Check 8: SYS_REFCURSOR param still present
  if (contract.sysRefCursor) {
    const cursorParam = contract.sysRefCursor.paramName.toUpperCase();
    const found = unit.arguments.some(a => a.name?.toUpperCase() === cursorParam);
    if (!found) {
      findings.push({
        severity: "broken",
        category: "argument",
        message: `SYS_REFCURSOR output parameter '${cursorParam}' no longer exists in '${qualifiedName}'.`
      });
    }
  }

  // Check 7: procedure argument alignment
  if (contract.procedureParams?.length) {
    checkArgumentsDrift(contract, unit, qualifiedName, findings);
  }
}

function checkArgumentsDrift(
  contract: ResolvedApiContract,
  unit: OracleInspectedProgramUnit,
  qualifiedName: string,
  findings: DriftFinding[]
): void {
  const oracleArgs = new Map<string, { direction: string; oracleType: string }>();
  for (const arg of unit.arguments) {
    if (arg.name) oracleArgs.set(arg.name.toUpperCase(), { direction: arg.direction, oracleType: arg.oracleType });
  }

  for (const param of contract.procedureParams ?? []) {
    // sys_refcursor output params are validated via the sysRefCursor mapping
    if (param.oracleType === "sys_refcursor") continue;
    // position-0 return values are not in unit.arguments
    if (param.direction === "return") continue;

    const oracleArg = oracleArgs.get(param.paramName.toUpperCase());
    if (!oracleArg) {
      findings.push({
        severity: "broken",
        category: "argument",
        message: `Procedure parameter '${param.paramName}' in '${qualifiedName}' no longer exists in Oracle.`
      });
      continue;
    }

    const expectedDir = contractDirToOracle(param.direction);
    if (expectedDir !== oracleArg.direction) {
      findings.push({
        severity: "broken",
        category: "argument",
        message: `Parameter '${param.paramName}' direction changed: contract expects ${expectedDir}, Oracle reports ${oracleArg.direction}.`
      });
    }

    const expectedType = param.oracleType.toUpperCase();
    const actualType = oracleArg.oracleType.toUpperCase();
    if (!isTypeCompatible(expectedType, actualType)) {
      findings.push({
        severity: "broken",
        category: "argument",
        message: `Parameter '${param.paramName}' type changed: contract expects ${expectedType}, Oracle reports ${actualType}.`
      });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function contractDirToOracle(direction: string): string {
  if (direction === "inout") return "IN/OUT";
  return direction.toUpperCase();
}

function isTypeCompatible(contractType: string, oracleType: string): boolean {
  const c = contractType.toUpperCase();
  const o = oracleType.toUpperCase();
  if (c === o) return true;
  // TIMESTAMP(n) variants are compatible with a TIMESTAMP contract type
  if (c === "TIMESTAMP" && o.startsWith("TIMESTAMP")) return true;
  // NUMBER-family types are compatible with a NUMBER contract type
  if (c === "NUMBER" && (o === "INTEGER" || o === "FLOAT" || o === "BINARY_FLOAT" || o === "BINARY_DOUBLE")) return true;
  return false;
}

function computeStatus(findings: DriftFinding[]): DriftStatus {
  if (findings.some(f => f.severity === "broken")) return "broken";
  if (findings.some(f => f.severity === "drifted")) return "drifted";
  if (findings.some(f => f.severity === "warning")) return "warning";
  return "healthy";
}
