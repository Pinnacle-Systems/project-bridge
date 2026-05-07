import { describe, expect, it } from "vitest";
import { checkContractDrift } from "../checker.js";
import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleSchemaSnapshot, OracleInspectedObject } from "../../oracleInspector/index.js";

// ─── Factories ───────────────────────────────────────────────────────────────

function baseObject(overrides: Partial<OracleInspectedObject> = {}): OracleInspectedObject {
  return {
    owner: "HR",
    objectName: "EMPLOYEES",
    objectType: "TABLE",
    objectStatus: "VALID",
    columns: [
      { name: "EMPLOYEE_ID", oracleType: "NUMBER",   nullable: false, dataLength: 22,  precision: 10, scale: 0,    charLength: null, dataDefault: null },
      { name: "FULL_NAME",   oracleType: "VARCHAR2",  nullable: true,  dataLength: 200, precision: null, scale: null, charLength: 200,  dataDefault: null }
    ],
    constraints: [],
    indexes: [],
    ...overrides
  };
}

function makeSnapshot(overrides: Partial<OracleSchemaSnapshot> = {}): OracleSchemaSnapshot {
  return {
    connectionId: "conn-1",
    owner: "HR",
    inspectedAt: new Date().toISOString(),
    objects: [baseObject()],
    sequences: [{ owner: "HR", name: "EMPLOYEE_SEQ" }],
    programUnits: [],
    ...overrides
  };
}

function tableContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c-table",
    resource: "employees",
    version: 1,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees:v1", schemaVersion: "1" },
    source: { database: "db1", owner: "HR", type: "table", name: "EMPLOYEES" },
    operations: [{ operation: "list", enabled: true }],
    fields: [
      { apiField: "id",   apiType: "integer", oracleType: "number",   dbColumn: "EMPLOYEE_ID" },
      { apiField: "name", apiType: "string",  oracleType: "varchar2", dbColumn: "FULL_NAME"   }
    ],
    ...overrides
  };
}

function packageContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c-pkg",
    resource: "employees",
    version: 2,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees:v2", schemaVersion: "1" },
    source: { database: "db1", owner: "HR", type: "package", packageName: "PKG_EMP", procedureName: "CREATE_EMP" },
    operations: [{ operation: "create", enabled: true }],
    fields: [],
    procedureParams: [
      { paramName: "P_NAME",   direction: "in",  apiField: "name",   oracleType: "varchar2", required: true },
      { paramName: "P_SALARY", direction: "in",  apiField: "salary", oracleType: "number" },
      { paramName: "P_ID",     direction: "out", apiField: "id",     oracleType: "number" }
    ],
    ...overrides
  };
}

function validProgramUnit() {
  return {
    owner: "HR",
    packageName: "PKG_EMP",
    name: "CREATE_EMP",
    unitType: "PACKAGE_PROCEDURE" as const,
    objectStatus: "VALID" as const,
    arguments: [
      { name: "P_NAME",   position: 1, direction: "IN"  as const, oracleType: "VARCHAR2", isSysRefCursor: false },
      { name: "P_SALARY", position: 2, direction: "IN"  as const, oracleType: "NUMBER",   isSysRefCursor: false },
      { name: "P_ID",     position: 3, direction: "OUT" as const, oracleType: "NUMBER",   isSysRefCursor: false }
    ],
    returnType: null
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("checkContractDrift", () => {
  it("returns healthy when table and all mapped columns exist and are compatible", () => {
    const result = checkContractDrift(tableContract(), makeSnapshot());
    expect(result.status).toBe("healthy");
    expect(result.findings).toHaveLength(0);
  });

  // ── Test 1: Missing column ──────────────────────────────────────────────

  it("1. Missing column marks status Broken", () => {
    const snapshot = makeSnapshot({
      objects: [baseObject({
        columns: [
          // FULL_NAME is removed from Oracle
          { name: "EMPLOYEE_ID", oracleType: "NUMBER", nullable: false, dataLength: 22, precision: 10, scale: 0, charLength: null, dataDefault: null }
        ]
      })]
    });

    const result = checkContractDrift(tableContract(), snapshot);

    expect(result.status).toBe("broken");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ severity: "broken", category: "column" })
    );
    const finding = result.findings.find(f => f.category === "column" && f.severity === "broken");
    expect(finding?.message).toContain("FULL_NAME");
  });

  // ── Test 2: Length reduction ────────────────────────────────────────────

  it("2. Character length reduction marks status Warning", () => {
    const contract = tableContract({
      fields: [
        { apiField: "id",   apiType: "integer", oracleType: "number",   dbColumn: "EMPLOYEE_ID" },
        {
          apiField: "name", apiType: "string",  oracleType: "varchar2", dbColumn: "FULL_NAME",
          columnHints: { charLength: 200 }   // was 200 at publish time
        }
      ]
    });
    const snapshot = makeSnapshot({
      objects: [baseObject({
        columns: [
          { name: "EMPLOYEE_ID", oracleType: "NUMBER",  nullable: false, dataLength: 22, precision: 10, scale: 0,   charLength: null, dataDefault: null },
          { name: "FULL_NAME",   oracleType: "VARCHAR2", nullable: true, dataLength: 50, precision: null, scale: null, charLength: 50, dataDefault: null }
        ]
      })]
    });

    const result = checkContractDrift(contract, snapshot);

    expect(result.status).toBe("warning");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ severity: "warning", category: "column" })
    );
    const finding = result.findings.find(f => f.category === "column" && f.severity === "warning");
    expect(finding?.message).toContain("FULL_NAME");
    expect(finding?.message).toContain("200");
    expect(finding?.message).toContain("50");
  });

  it("2b. Numeric precision reduction marks status Drifted", () => {
    const contract = tableContract({
      fields: [
        {
          apiField: "salary", apiType: "number", oracleType: "number", dbColumn: "SALARY",
          columnHints: { precision: 12 }
        }
      ]
    });
    const snapshot = makeSnapshot({
      objects: [baseObject({
        columns: [
          { name: "SALARY", oracleType: "NUMBER", nullable: true, dataLength: 22, precision: 8, scale: 2, charLength: null, dataDefault: null }
        ]
      })]
    });

    const result = checkContractDrift(contract, snapshot);

    expect(result.status).toBe("drifted");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ severity: "drifted", category: "column" })
    );
  });

  // ── Test 3: Missing sequence ────────────────────────────────────────────

  it("3. Missing sequence marks status Broken", () => {
    const contract = tableContract({
      idGeneration: { strategy: "sequence", sequenceName: "EMPLOYEE_SEQ" }
    });
    const snapshot = makeSnapshot({ sequences: [] }); // sequence removed from Oracle

    const result = checkContractDrift(contract, snapshot);

    expect(result.status).toBe("broken");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ severity: "broken", category: "sequence" })
    );
    const finding = result.findings.find(f => f.category === "sequence");
    expect(finding?.message).toContain("EMPLOYEE_SEQ");
  });

  // ── Test 4: Procedure argument change ──────────────────────────────────

  it("4. Removed procedure parameter marks status Broken", () => {
    const contract = packageContract();
    const snapshot = makeSnapshot({
      objects: [],
      programUnits: [{
        ...validProgramUnit(),
        arguments: [
          { name: "P_NAME", position: 1, direction: "IN" as const, oracleType: "VARCHAR2", isSysRefCursor: false },
          // P_SALARY removed from Oracle
          { name: "P_ID",   position: 2, direction: "OUT" as const, oracleType: "NUMBER",  isSysRefCursor: false }
        ]
      }]
    });

    const result = checkContractDrift(contract, snapshot);

    expect(result.status).toBe("broken");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ severity: "broken", category: "argument" })
    );
    const finding = result.findings.find(f => f.category === "argument" && f.severity === "broken");
    expect(finding?.message).toContain("P_SALARY");
  });

  it("4b. Procedure parameter type change marks status Broken", () => {
    const contract = packageContract();
    const snapshot = makeSnapshot({
      objects: [],
      programUnits: [{
        ...validProgramUnit(),
        arguments: [
          { name: "P_NAME",   position: 1, direction: "IN"  as const, oracleType: "NUMBER",   isSysRefCursor: false }, // was VARCHAR2
          { name: "P_SALARY", position: 2, direction: "IN"  as const, oracleType: "NUMBER",   isSysRefCursor: false },
          { name: "P_ID",     position: 3, direction: "OUT" as const, oracleType: "NUMBER",   isSysRefCursor: false }
        ]
      }]
    });

    const result = checkContractDrift(contract, snapshot);

    expect(result.status).toBe("broken");
    const finding = result.findings.find(f => f.category === "argument" && f.severity === "broken");
    expect(finding?.message).toContain("P_NAME");
  });

  // ── Test 5: Invalid package ─────────────────────────────────────────────

  it("5. INVALID package status marks status Broken", () => {
    const contract = packageContract();
    const snapshot = makeSnapshot({
      objects: [],
      programUnits: [{
        ...validProgramUnit(),
        objectStatus: "INVALID"   // package has compilation errors
      }]
    });

    const result = checkContractDrift(contract, snapshot);

    expect(result.status).toBe("broken");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ severity: "broken", category: "procedure" })
    );
    const finding = result.findings.find(f => f.category === "procedure" && f.severity === "broken");
    expect(finding?.message).toContain("INVALID");
  });

  // ── Additional checks ───────────────────────────────────────────────────

  it("missing source table marks status Broken", () => {
    const snapshot = makeSnapshot({ objects: [] }); // table gone
    const result = checkContractDrift(tableContract(), snapshot);
    expect(result.status).toBe("broken");
    expect(result.findings).toContainEqual(expect.objectContaining({ severity: "broken", category: "object" }));
  });

  it("INVALID source view marks status Broken", () => {
    const contract = tableContract({
      source: { database: "db1", owner: "HR", type: "view", name: "EMPLOYEES_V" }
    });
    const snapshot = makeSnapshot({
      objects: [baseObject({ objectName: "EMPLOYEES_V", objectType: "VIEW", objectStatus: "INVALID" })]
    });
    const result = checkContractDrift(contract, snapshot);
    expect(result.status).toBe("broken");
    expect(result.findings).toContainEqual(expect.objectContaining({ severity: "broken", category: "object" }));
  });

  it("column type mismatch marks status Broken", () => {
    const snapshot = makeSnapshot({
      objects: [baseObject({
        columns: [
          { name: "EMPLOYEE_ID", oracleType: "VARCHAR2", nullable: false, dataLength: 22, precision: null, scale: null, charLength: 22, dataDefault: null },
          { name: "FULL_NAME",   oracleType: "VARCHAR2", nullable: true,  dataLength: 200, precision: null, scale: null, charLength: 200, dataDefault: null }
        ]
      })]
    });
    const result = checkContractDrift(tableContract(), snapshot);
    expect(result.status).toBe("broken");
    const finding = result.findings.find(f => f.category === "column" && f.message.includes("EMPLOYEE_ID"));
    expect(finding?.severity).toBe("broken");
  });

  it("missing procedure marks status Broken", () => {
    const snapshot = makeSnapshot({ objects: [], programUnits: [] });
    const result = checkContractDrift(packageContract(), snapshot);
    expect(result.status).toBe("broken");
    expect(result.findings).toContainEqual(expect.objectContaining({ severity: "broken", category: "procedure" }));
  });

  it("result metadata includes contract id, version, owner, and object name", () => {
    const result = checkContractDrift(tableContract(), makeSnapshot());
    expect(result.contractId).toBe("c-table");
    expect(result.contractVersion).toBe(1);
    expect(result.oracleOwner).toBe("HR");
    expect(result.oracleObject).toBe("EMPLOYEES");
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  it("TIMESTAMP(6) is compatible with a timestamp contract field", () => {
    const contract = tableContract({
      fields: [
        { apiField: "created", apiType: "date-time", oracleType: "timestamp", dbColumn: "CREATED_AT" }
      ]
    });
    const snapshot = makeSnapshot({
      objects: [baseObject({
        columns: [
          { name: "CREATED_AT", oracleType: "TIMESTAMP(6)", nullable: true, dataLength: 11, precision: null, scale: 6, charLength: null, dataDefault: null }
        ]
      })]
    });
    const result = checkContractDrift(contract, snapshot);
    expect(result.status).toBe("healthy");
  });

  it("sequence present marks status healthy for that check", () => {
    const contract = tableContract({
      idGeneration: { strategy: "sequence", sequenceName: "EMPLOYEE_SEQ" }
    });
    const result = checkContractDrift(contract, makeSnapshot());
    expect(result.status).toBe("healthy");
  });
});
