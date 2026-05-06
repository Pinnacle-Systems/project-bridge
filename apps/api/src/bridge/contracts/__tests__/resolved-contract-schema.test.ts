import { describe, expect, it } from "vitest";

import { validateResolvedApiContract } from "../index.js";

function validResolvedContract() {
  return {
    id: "9f0ff456-3b98-4a16-8894-89ded774b825",
    resource: "employees",
    endpoint: "/api/hr/employees",
    version: 1,
    status: "active",
    publishedAt: "2026-05-06T00:00:00.000Z",
    publishedBy: "admin",
    runtime: {
      cacheKey: "employees:v1",
      schemaVersion: "1"
    },
    schemaHealth: {
      status: "healthy",
      checkedAt: "2026-05-06T00:00:00.000Z",
      oracleObjectStatus: "valid"
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
        oracleType: "number",
        readOnly: true
      },
      {
        apiField: "active",
        apiType: "boolean",
        dbColumn: "ACTIVE_FLAG",
        oracleType: "char",
        transformers: [
          {
            kind: "booleanMapping",
            oracleType: "char",
            trueValue: "Y",
            falseValue: "N"
          }
        ]
      }
    ],
    operations: [
      {
        operation: "read",
        enabled: true,
        permission: "employee.read"
      },
      {
        operation: "list",
        enabled: true,
        permission: "employee.read"
      }
    ],
    optimisticLocking: {
      enabled: true,
      apiField: "updatedAt",
      dbColumn: "UPDATED_AT",
      oracleType: "timestamp"
    },
    pagination: {
      defaultLimit: 50,
      maxLimit: 250,
      strategy: "offsetFetch"
    }
  };
}

describe("ResolvedApiContract runtime schema", () => {
  it("passes a valid resolved contract", () => {
    const result = validateResolvedApiContract(validResolvedContract());

    expect(result.success).toBe(true);
  });

  it("fails when source is missing", () => {
    const contract = validResolvedContract();
    Reflect.deleteProperty(contract, "source");

    const result = validateResolvedApiContract(contract);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "source" })]));
  });

  it("fails when fields are missing", () => {
    const contract = validResolvedContract();
    Reflect.deleteProperty(contract, "fields");

    const result = validateResolvedApiContract(contract);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "fields" })]));
  });

  it("fails for invalid boolean transformer config", () => {
    const contract = validResolvedContract();
    contract.fields[1].transformers = [
      {
        kind: "booleanMapping",
        oracleType: "date",
        trueValue: "Y",
        falseValue: "Y"
      }
    ];

    const result = validateResolvedApiContract(contract);

    expect(result.success).toBe(false);
    expect(result.issues.some((issue) => issue.path.includes("transformers"))).toBe(true);
  });

  it("fails for invalid SYS_REFCURSOR mapping", () => {
    const contract = {
      ...validResolvedContract(),
      source: {
        database: "legacy_oracle",
        owner: "HRMS_OWNER",
        type: "package",
        packageName: "PKG_EMPLOYEE_API",
        procedureName: "GET_EMPLOYEES"
      },
      fields: [],
      procedureParams: [
        {
          paramName: "P_RESULT",
          direction: "out",
          oracleType: "sys_refcursor"
        }
      ],
      sysRefCursor: {
        paramName: "P_OTHER_RESULT",
        fields: []
      }
    };

    const result = validateResolvedApiContract(contract);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "sysRefCursor.fields" }),
        expect.objectContaining({ path: "sysRefCursor.paramName" })
      ])
    );
  });
});
