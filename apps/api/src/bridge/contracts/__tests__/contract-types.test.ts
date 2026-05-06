import { describe, expect, it } from "vitest";

import type {
  BooleanMappingTransformer,
  DraftApiContract,
  ErrorMapping,
  ResolvedApiContract,
  SchemaHealth,
  TrimRightTransformer
} from "../index.js";

describe("Bridge contract types", () => {
  it("supports table-backed draft contracts with Oracle-specific metadata", () => {
    const activeFlagTransformer = {
      kind: "booleanMapping",
      oracleType: "char",
      trueValue: "Y",
      falseValue: "N"
    } satisfies BooleanMappingTransformer;

    const trimCodeTransformer = {
      kind: "trimRight",
      oracleType: "char"
    } satisfies TrimRightTransformer;

    const contract = {
      resource: "employees",
      endpoint: "/api/hr/employees",
      source: {
        database: "legacy_oracle",
        owner: "HRMS_OWNER",
        type: "table",
        name: "EMPLOYEE_MASTER"
      },
      fields: [
        {
          apiField: "id",
          apiType: "integer",
          dbColumn: "EMPLOYEE_ID",
          oracleType: "number",
          readOnly: true
        },
        {
          apiField: "employeeCode",
          apiType: "string",
          dbColumn: "EMPLOYEE_CODE",
          oracleType: "char",
          transformers: [trimCodeTransformer]
        },
        {
          apiField: "active",
          apiType: "boolean",
          dbColumn: "ACTIVE_FLAG",
          oracleType: "char",
          transformers: [activeFlagTransformer]
        }
      ],
      operations: [
        {
          operation: "list",
          enabled: true,
          permission: "employee.read"
        },
        {
          operation: "create",
          enabled: false
        }
      ],
      idGeneration: {
        strategy: "sequence",
        sequenceName: "EMPLOYEE_SEQ"
      },
      pagination: {
        defaultLimit: 50,
        maxLimit: 250,
        strategy: "offsetFetch"
      },
      optimisticLocking: {
        enabled: true,
        apiField: "updatedAt",
        dbColumn: "UPDATED_AT",
        oracleType: "timestamp"
      }
    } satisfies DraftApiContract;

    expect(contract.source.owner).toBe("HRMS_OWNER");
    expect(contract.pagination.strategy).toBe("offsetFetch");
    expect(contract.idGeneration.strategy).toBe("sequence");
  });

  it("supports procedure-backed drafts with SYS_REFCURSOR output mapping", () => {
    const contract = {
      resource: "employeeSummaries",
      endpoint: "/api/hr/employee-summaries",
      source: {
        database: "legacy_oracle",
        owner: "HRMS_OWNER",
        type: "package",
        packageName: "PKG_EMPLOYEE_API",
        procedureName: "GET_EMPLOYEE_SUMMARIES"
      },
      fields: [],
      operations: [
        {
          operation: "list",
          enabled: true,
          permission: "employee.summary.read"
        }
      ],
      procedureParams: [
        {
          paramName: "P_DEPARTMENT_ID",
          direction: "in",
          apiField: "departmentId",
          oracleType: "number"
        },
        {
          paramName: "P_RESULT",
          direction: "out",
          oracleType: "sys_refcursor"
        }
      ],
      sysRefCursor: {
        paramName: "P_RESULT",
        fields: [
          {
            apiField: "employeeId",
            apiType: "integer",
            dbColumn: "EMPLOYEE_ID",
            oracleType: "number"
          },
          {
            apiField: "employeeName",
            apiType: "string",
            dbColumn: "EMPLOYEE_NAME",
            oracleType: "varchar2"
          }
        ]
      },
      pagination: {
        defaultLimit: 25,
        maxLimit: 100,
        strategy: "rownum"
      }
    } satisfies DraftApiContract;

    expect(contract.source.packageName).toBe("PKG_EMPLOYEE_API");
    expect(contract.sysRefCursor.paramName).toBe("P_RESULT");
    expect(contract.pagination.strategy).toBe("rownum");
  });

  it("supports resolved contracts with errors and schema health", () => {
    const schemaHealth = {
      status: "healthy",
      checkedAt: new Date("2026-05-06T00:00:00.000Z"),
      oracleObjectStatus: "valid"
    } satisfies SchemaHealth;

    const uniqueConstraintError = {
      oracleCode: "ORA-00001",
      apiCode: "UNIQUE_CONSTRAINT_VIOLATION",
      httpStatus: 409,
      message: "A matching record already exists."
    } satisfies ErrorMapping;

    const contract = {
      id: "9f0ff456-3b98-4a16-8894-89ded774b825",
      resource: "employees",
      endpoint: "/api/hr/employees",
      version: 1,
      status: "active",
      publishedAt: new Date("2026-05-06T00:00:00.000Z"),
      publishedBy: "admin",
      schemaHealth,
      runtime: {
        cacheKey: "employees:v1",
        schemaVersion: "1"
      },
      source: {
        database: "legacy_oracle",
        owner: "HRMS_OWNER",
        type: "table",
        name: "EMPLOYEE_MASTER"
      },
      fields: [
        {
          apiField: "id",
          apiType: "integer",
          dbColumn: "EMPLOYEE_ID",
          oracleType: "number"
        }
      ],
      operations: [
        {
          operation: "read",
          enabled: true
        }
      ],
      idGeneration: {
        strategy: "trigger",
        returningColumn: "EMPLOYEE_ID"
      },
      errorMappings: [uniqueConstraintError]
    } satisfies ResolvedApiContract;

    expect(contract.status).toBe("active");
    expect(contract.idGeneration.strategy).toBe("trigger");
    expect(contract.errorMappings[0].oracleCode).toBe("ORA-00001");
  });
});
