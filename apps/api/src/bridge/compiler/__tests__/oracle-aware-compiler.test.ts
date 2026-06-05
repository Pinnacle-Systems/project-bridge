import { describe, expect, it } from "vitest";

import type { DraftApiContract } from "../../contracts/index.js";
import type { OracleSchemaSnapshot } from "../../oracleInspector/index.js";
import {
  createOracleAwareContractCompiler,
  type ContractCompilerStore
} from "../index.js";

function schemaSnapshot(overrides: Partial<OracleSchemaSnapshot> = {}): OracleSchemaSnapshot {
  return {
    connectionId: "connection-1",
    owner: "HRMS_OWNER",
    inspectedAt: "2026-05-06T00:00:00.000Z",
    sequences: [],
    programUnits: [],
    objects: [
      {
        owner: "HRMS_OWNER",
        objectName: "EMPLOYEE_MASTER",
        objectType: "TABLE",
        objectStatus: "VALID",
        columns: [
          {
            name: "EMPLOYEE_ID",
            oracleType: "NUMBER",
            nullable: false,
            dataLength: 22,
            precision: 10,
            scale: 0,
            charLength: 0,
            dataDefault: null
          },
          {
            name: "EMPLOYEE_NAME",
            oracleType: "VARCHAR2",
            nullable: false,
            dataLength: 150,
            precision: null,
            scale: null,
            charLength: 150,
            dataDefault: null
          },
          {
            name: "STATUS_CODE",
            oracleType: "CHAR",
            nullable: true,
            dataLength: 10,
            precision: null,
            scale: null,
            charLength: 10,
            dataDefault: null
          },
          {
            name: "ACTIVE_FLAG",
            oracleType: "CHAR",
            nullable: false,
            dataLength: 1,
            precision: null,
            scale: null,
            charLength: 1,
            dataDefault: null
          },
          {
            name: "IS_MANAGER",
            oracleType: "NUMBER",
            nullable: false,
            dataLength: 22,
            precision: 1,
            scale: 0,
            charLength: 0,
            dataDefault: null
          },
          {
            name: "CREATED_AT",
            oracleType: "DATE",
            nullable: false,
            dataLength: 7,
            precision: null,
            scale: null,
            charLength: 0,
            dataDefault: null
          },
          {
            name: "CURSOR_RESULT",
            oracleType: "SYS_REFCURSOR",
            nullable: true,
            dataLength: null,
            precision: null,
            scale: null,
            charLength: null,
            dataDefault: null
          }
        ],
        constraints: [],
        indexes: []
      }
    ],
    ...overrides
  };
}

function draftContract(overrides: Partial<DraftApiContract> = {}): DraftApiContract {
  return {
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
        oracleType: "number"
      },
      {
        apiField: "name",
        apiType: "string",
        dbColumn: "EMPLOYEE_NAME",
        oracleType: "varchar2"
      }
    ],
    operations: [
      {
        operation: "read",
        enabled: true
      },
      {
        operation: "list",
        enabled: true
      }
    ],
    filters: [{ field: "name" }],
    sorts: [{ field: "id" }],
    ...overrides
  };
}

function packageSnapshot(): OracleSchemaSnapshot {
  return schemaSnapshot({
    programUnits: [
      {
        owner: "HRMS_OWNER",
        packageName: "PKG_EMPLOYEE_API",
        name: "CREATE_EMPLOYEE",
        unitType: "PACKAGE_PROCEDURE",
        objectStatus: "VALID",
        returnType: null,
        arguments: [
          {
            name: "P_EMPLOYEE_NAME",
            position: 1,
            direction: "IN",
            oracleType: "VARCHAR2",
            isSysRefCursor: false
          },
          {
            name: "P_EMPLOYEE_ID",
            position: 2,
            direction: "OUT",
            oracleType: "NUMBER",
            isSysRefCursor: false
          }
        ]
      },
      {
        owner: "HRMS_OWNER",
        packageName: "PKG_EMPLOYEE_API",
        name: "GET_EMPLOYEES",
        unitType: "PACKAGE_PROCEDURE",
        objectStatus: "VALID",
        returnType: null,
        arguments: [
          {
            name: "P_DEPARTMENT_ID",
            position: 1,
            direction: "IN",
            oracleType: "NUMBER",
            isSysRefCursor: false
          },
          {
            name: "P_RESULT",
            position: 2,
            direction: "OUT",
            oracleType: "REF CURSOR",
            isSysRefCursor: true
          }
        ]
      }
    ]
  });
}

function packageCreateDraft(overrides: Partial<DraftApiContract> = {}): DraftApiContract {
  return {
    resource: "employees",
    endpoint: "/api/hr/employees",
    source: {
      database: "legacy_oracle",
      owner: "HRMS_OWNER",
      type: "package",
      packageName: "PKG_EMPLOYEE_API",
      procedureName: "CREATE_EMPLOYEE"
    },
    fields: [
      {
        apiField: "id",
        apiType: "integer",
        oracleType: "number"
      }
    ],
    operations: [
      {
        operation: "create",
        enabled: true
      }
    ],
    procedureParams: [
      {
        paramName: "P_EMPLOYEE_NAME",
        direction: "in",
        apiField: "name",
        oracleType: "varchar2",
        required: true
      },
      {
        paramName: "P_EMPLOYEE_ID",
        direction: "out",
        apiField: "id",
        oracleType: "number"
      }
    ],
    ...overrides
  };
}

function createStore(snapshot = schemaSnapshot()): ContractCompilerStore {
  return {
    apiConnection: {
      async findUnique() {
        return {
          id: "connection-1",
          paginationStrategy: "offsetFetch"
        };
      }
    },
    oracleSchemaSnapshot: {
      async findFirst() {
        return { snapshotData: snapshot };
      }
    }
    // No bridgeTenant — tenant validation is skipped for these tests
  };
}

// Tenant-aware store: enforces tenant validation
function createTenantAwareStore(
  snapshot = schemaSnapshot(),
  opts: {
    tenantStatus?: string;
    connectionAssigned?: boolean;
    connectionStatus?: string;
  } = {}
): ContractCompilerStore {
  const { tenantStatus = "active", connectionAssigned = true, connectionStatus = "active" } = opts;
  return {
    apiConnection: {
      async findUnique() {
        return { id: "connection-1", paginationStrategy: "offsetFetch" };
      }
    },
    oracleSchemaSnapshot: {
      async findFirst() {
        return { snapshotData: snapshot };
      }
    },
    bridgeTenant: {
      async findUnique({ where }) {
        if (where.id === "tenant-1") return { id: "tenant-1", status: tenantStatus };
        return null;
      }
    },
    bridgeTenantConnection: {
      async findFirst({ where }) {
        if (!connectionAssigned) return null;
        if (where.tenantId === "tenant-1" && where.apiConnectionId === "connection-1") {
          return { id: "tc-1", status: connectionStatus };
        }
        return null;
      }
    }
  };
}

describe("Oracle-aware contract compiler", () => {
  it("compiles a valid table read contract", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract(),
      version: 3,
      compiledBy: "admin"
    });

    expect(result.contract).toMatchObject({
      resource: "employees",
      endpoint: "/api/hr/employees",
      version: 3,
      status: "active",
      pagination: {
        defaultLimit: 50,
        maxLimit: 250,
        strategy: "offsetFetch"
      },
      runtime: {
        cacheKey: "/api/hr/employees:v3",
        schemaVersion: "1"
      }
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONTRACT_COMPILED",
          severity: "info"
        })
      ])
    );
  });

  it("fails when source table is missing", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        source: {
          database: "legacy_oracle",
          owner: "HRMS_OWNER",
          type: "table",
          name: "MISSING_TABLE"
        }
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SOURCE_OBJECT_NOT_FOUND" })])
    );
  });

  it("fails when a mapped column is missing", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        fields: [
          {
            apiField: "id",
            apiType: "integer",
            dbColumn: "MISSING_ID",
            oracleType: "number"
          }
        ]
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MAPPED_COLUMN_NOT_FOUND" })])
    );
  });

  it("fails when a filter field is not mapped", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        filters: [{ field: "missingFilter" }]
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "FILTER_FIELD_NOT_MAPPED" })])
    );
  });

  it("fails when a sort field is not mapped", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        sorts: [{ field: "missingSort" }]
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SORT_FIELD_NOT_MAPPED" })])
    );
  });

  it("fails when source object status is invalid", async () => {
    const compiler = createOracleAwareContractCompiler(
      createStore(
        schemaSnapshot({
          objects: [
            {
              ...schemaSnapshot().objects[0],
              objectStatus: "INVALID"
            }
          ]
        })
      )
    );

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract()
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SOURCE_OBJECT_INVALID" })])
    );
  });

  it("defaults CHAR string fields to trimRight transformer", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        fields: [
          {
            apiField: "statusCode",
            apiType: "string",
            dbColumn: "STATUS_CODE",
            oracleType: "char"
          }
        ],
        filters: [],
        sorts: []
      })
    });

    expect(result.contract?.fields[0].transformers).toEqual([
      {
        kind: "trimRight",
        oracleType: "char"
      }
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TRIM_RIGHT_DEFAULTED" })])
    );
  });

  it("compiles Y/N boolean mapping", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        fields: [
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
        filters: [],
        sorts: []
      })
    });

    expect(result.contract?.fields[0].apiType).toBe("boolean");
    expect(result.contract?.fields[0].transformers?.[0]).toMatchObject({
      kind: "booleanMapping",
      trueValue: "Y",
      falseValue: "N"
    });
  });

  it("compiles 1/0 boolean mapping", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        fields: [
          {
            apiField: "manager",
            apiType: "boolean",
            dbColumn: "IS_MANAGER",
            oracleType: "number",
            transformers: [
              {
                kind: "booleanMapping",
                oracleType: "number",
                trueValue: 1,
                falseValue: 0
              }
            ]
          }
        ],
        filters: [],
        sorts: []
      })
    });

    expect(result.contract?.fields[0].transformers?.[0]).toMatchObject({
      kind: "booleanMapping",
      trueValue: 1,
      falseValue: 0
    });
  });

  it("fails boolean field without transformer", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        fields: [
          {
            apiField: "active",
            apiType: "boolean",
            dbColumn: "ACTIVE_FLAG",
            oracleType: "char"
          }
        ],
        filters: [],
        sorts: []
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "BOOLEAN_MAPPING_REQUIRED" })])
    );
  });

  it("fails SYS_REFCURSOR on table field", async () => {
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: draftContract({
        fields: [
          {
            apiField: "result",
            apiType: "object",
            dbColumn: "CURSOR_RESULT",
            oracleType: "sys_refcursor"
          }
        ],
        filters: [],
        sorts: []
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SYS_REFCURSOR_TABLE_FIELD_INVALID" })])
    );
  });

  it("compiles a valid package-backed create contract", async () => {
    const compiler = createOracleAwareContractCompiler(createStore(packageSnapshot()));

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: packageCreateDraft()
    });

    expect(result.contract).toMatchObject({
      source: {
        type: "package",
        packageName: "PKG_EMPLOYEE_API",
        procedureName: "CREATE_EMPLOYEE"
      },
      operations: [{ operation: "create", enabled: true }]
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "CONTRACT_COMPILED" })])
    );
  });

  it("fails when package procedure is missing", async () => {
    const compiler = createOracleAwareContractCompiler(createStore(packageSnapshot()));

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: packageCreateDraft({
        source: {
          database: "legacy_oracle",
          owner: "HRMS_OWNER",
          type: "package",
          packageName: "PKG_EMPLOYEE_API",
          procedureName: "MISSING_PROC"
        }
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PROCEDURE_NOT_FOUND" })])
    );
  });

  it("fails when configured procedure param direction is wrong", async () => {
    const compiler = createOracleAwareContractCompiler(createStore(packageSnapshot()));

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: packageCreateDraft({
        procedureParams: [
          {
            paramName: "P_EMPLOYEE_NAME",
            direction: "out",
            apiField: "name",
            oracleType: "varchar2"
          }
        ]
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PROCEDURE_ARG_DIRECTION_MISMATCH" })])
    );
  });

  it("compiles SYS_REFCURSOR readList with row mapping", async () => {
    const compiler = createOracleAwareContractCompiler(createStore(packageSnapshot()));

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: {
        resource: "employees",
        endpoint: "/api/hr/employees",
        source: {
          database: "legacy_oracle",
          owner: "HRMS_OWNER",
          type: "package",
          packageName: "PKG_EMPLOYEE_API",
          procedureName: "GET_EMPLOYEES"
        },
        fields: [],
        operations: [{ operation: "list", enabled: true }],
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
              apiField: "id",
              apiType: "integer",
              dbColumn: "EMPLOYEE_ID",
              oracleType: "number"
            },
            {
              apiField: "name",
              apiType: "string",
              dbColumn: "EMPLOYEE_NAME",
              oracleType: "varchar2"
            }
          ]
        }
      }
    });

    expect(result.contract?.sysRefCursor?.paramName).toBe("P_RESULT");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "CONTRACT_COMPILED" })])
    );
  });

  it("fails SYS_REFCURSOR without row mapping", async () => {
    const compiler = createOracleAwareContractCompiler(createStore(packageSnapshot()));

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: packageCreateDraft({
        source: {
          database: "legacy_oracle",
          owner: "HRMS_OWNER",
          type: "package",
          packageName: "PKG_EMPLOYEE_API",
          procedureName: "GET_EMPLOYEES"
        },
        operations: [{ operation: "list", enabled: true }],
        procedureParams: [
          {
            paramName: "P_RESULT",
            direction: "out",
            oracleType: "sys_refcursor"
          }
        ]
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SYS_REFCURSOR_ROW_MAPPING_REQUIRED" })])
    );
  });

  it("fails SYS_REFCURSOR for write operations", async () => {
    const compiler = createOracleAwareContractCompiler(createStore(packageSnapshot()));

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: packageCreateDraft({
        source: {
          database: "legacy_oracle",
          owner: "HRMS_OWNER",
          type: "package",
          packageName: "PKG_EMPLOYEE_API",
          procedureName: "GET_EMPLOYEES"
        },
        operations: [{ operation: "create", enabled: true }],
        procedureParams: [
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
              apiField: "id",
              apiType: "integer",
              dbColumn: "EMPLOYEE_ID",
              oracleType: "number"
            }
          ]
        }
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SYS_REFCURSOR_WRITE_UNSUPPORTED" })])
    );
  });

  // ── Phase 9c — Tenant-aware compilation ────────────────────────────────────

  it("compiles successfully with active tenant and assigned connection", async () => {
    const compiler = createOracleAwareContractCompiler(createTenantAwareStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      tenantId: "tenant-1",
      draft: draftContract(),
      version: 1
    });

    expect(result.contract).toBeDefined();
    expect(result.contract?.runtime.tenantId).toBe("tenant-1");
    expect(result.contract?.runtime.apiConnectionId).toBe("connection-1");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "CONTRACT_COMPILED" })])
    );
  });

  it("fails when tenantId is missing and store enforces tenant validation", async () => {
    const compiler = createOracleAwareContractCompiler(createTenantAwareStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      // tenantId omitted
      draft: draftContract()
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TENANT_REQUIRED" })])
    );
  });

  it("fails when tenant does not exist", async () => {
    const compiler = createOracleAwareContractCompiler(createTenantAwareStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      tenantId: "no-such-tenant",
      draft: draftContract()
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TENANT_NOT_FOUND" })])
    );
  });

  it("fails when tenant is inactive", async () => {
    const compiler = createOracleAwareContractCompiler(
      createTenantAwareStore(schemaSnapshot(), { tenantStatus: "suspended" })
    );

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      tenantId: "tenant-1",
      draft: draftContract()
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TENANT_INACTIVE" })])
    );
  });

  it("fails when apiConnectionId is not assigned to tenant", async () => {
    const compiler = createOracleAwareContractCompiler(
      createTenantAwareStore(schemaSnapshot(), { connectionAssigned: false })
    );

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      tenantId: "tenant-1",
      draft: draftContract()
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "CONNECTION_NOT_ASSIGNED_TO_TENANT" })])
    );
  });

  it("fails when tenant-connection assignment is inactive", async () => {
    const compiler = createOracleAwareContractCompiler(
      createTenantAwareStore(schemaSnapshot(), { connectionStatus: "inactive" })
    );

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      tenantId: "tenant-1",
      draft: draftContract()
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TENANT_CONNECTION_INACTIVE" })])
    );
  });

  it("embeds tenantId and apiConnectionId in resolved contract runtime", async () => {
    const compiler = createOracleAwareContractCompiler(createTenantAwareStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      tenantId: "tenant-1",
      draft: draftContract(),
      version: 2
    });

    expect(result.contract?.runtime).toMatchObject({
      tenantId: "tenant-1",
      apiConnectionId: "connection-1",
      schemaVersion: "1"
    });
  });

  it("skips tenant validation when store has no bridgeTenant (dry-run mode)", async () => {
    // createStore() has no bridgeTenant — tenant validation is not enforced
    const compiler = createOracleAwareContractCompiler(createStore());

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      // tenantId omitted — allowed in dry-run mode
      draft: draftContract()
    });

    expect(result.contract).toBeDefined();
    expect(result.contract?.runtime.tenantId).toBeUndefined();
  });

  it("requires procedure-backed optimistic locking to have mapped version param", async () => {
    const compiler = createOracleAwareContractCompiler(createStore(packageSnapshot()));

    const result = await compiler.compile({
      apiConnectionId: "connection-1",
      draft: packageCreateDraft({
        operations: [{ operation: "update", enabled: true }],
        optimisticLocking: {
          enabled: true,
          apiField: "version",
          dbColumn: "VERSION_NO",
          oracleType: "number"
        }
      })
    });

    expect(result.contract).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OPTIMISTIC_LOCKING_PROCEDURE_UNSUPPORTED",
          severity: "error"
        })
      ])
    );
  });
});
