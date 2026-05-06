import { describe, expect, it, vi } from "vitest";

import type {
  OracleConnectionRecord,
  OracleConnectionRegistryStore,
  OracleConnectorAdapter,
  QueryResult
} from "../../connections/index.js";
import {
  createOracleSchemaInspector,
  type OracleSchemaInspectorStore,
  type OracleSchemaSnapshot
} from "../index.js";

function connectionRecord(overrides: Partial<OracleConnectionRecord> = {}): OracleConnectionRecord {
  return {
    id: "conn-1",
    name: "Legacy ERP",
    connectionType: "serviceName",
    host: "localhost",
    port: 1521,
    serviceName: "ERPDB",
    sid: null,
    tnsAlias: null,
    username: "erp_api",
    encryptedPassword: "encrypted-password-value",
    passwordSecretRef: null,
    walletPath: null,
    walletSecretRef: null,
    defaultOwner: "ERP_OWNER",
    oracleVersion: "19c",
    paginationStrategy: "offsetFetch",
    status: "active",
    createdAt: new Date("2026-05-06T00:00:00.000Z"),
    updatedAt: new Date("2026-05-06T00:00:00.000Z"),
    ...overrides
  };
}

function createStore(record: OracleConnectionRecord) {
  const snapshots: OracleSchemaSnapshot[] = [];
  const store: OracleSchemaInspectorStore = {
    apiConnection: {
      async create() {
        throw new Error("not used");
      },
      async update() {
        throw new Error("not used");
      },
      async findUnique() {
        return record;
      },
      async findMany() {
        return [record];
      }
    } satisfies OracleConnectionRegistryStore["apiConnection"],
    oracleSchemaSnapshot: {
      async create({ data }) {
        snapshots.push(data.snapshotData);
        return {
          id: "snapshot-1",
          apiConnectionId: data.apiConnectionId,
          oracleOwner: data.oracleOwner,
          snapshotData: data.snapshotData,
          capturedAt: new Date("2026-05-06T00:00:00.000Z"),
          capturedBy: data.capturedBy ?? null
        };
      }
    }
  };

  return { store, snapshots };
}

type MockOracleConnectorAdapter = OracleConnectorAdapter & {
  queryCalls: Array<{ sql: string; binds: unknown; options: unknown }>;
};

async function inspectMockSchema() {
  const { store } = createStore(connectionRecord());
  const inspector = createOracleSchemaInspector({
    store,
    adapterFactory: createMockAdapter
  });

  return inspector.inspectOracleSchema("conn-1", "ERP_OWNER");
}

function createMockAdapter(): MockOracleConnectorAdapter {
  const queryCalls: MockOracleConnectorAdapter["queryCalls"] = [];

  return {
    queryCalls,
    openConnection: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => true),
    async query<Row = unknown>(sql: string, binds: unknown, options: unknown): Promise<QueryResult<Row>> {
      queryCalls.push({ sql, binds, options });

      if (sql.includes("FROM all_tab_columns")) {
        return {
          rows: [
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "CUSTOMERS",
              COLUMN_NAME: "CUSTOMER_ID",
              DATA_TYPE: "NUMBER",
              NULLABLE: "N",
              DATA_LENGTH: 22,
              DATA_PRECISION: 10,
              DATA_SCALE: 0,
              CHAR_LENGTH: 0,
              DATA_DEFAULT: null
            },
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "CUSTOMERS",
              COLUMN_NAME: "CUSTOMER_NAME",
              DATA_TYPE: "VARCHAR2",
              NULLABLE: "Y",
              DATA_LENGTH: 150,
              DATA_PRECISION: null,
              DATA_SCALE: null,
              CHAR_LENGTH: 150,
              DATA_DEFAULT: null
            },
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "VW_CUSTOMER_SUMMARY",
              COLUMN_NAME: "CUSTOMER_ID",
              DATA_TYPE: "NUMBER",
              NULLABLE: "Y",
              DATA_LENGTH: 22,
              DATA_PRECISION: 10,
              DATA_SCALE: 0,
              CHAR_LENGTH: 0,
              DATA_DEFAULT: null
            }
          ] as Row[]
        };
      }

      if (sql.includes("FROM all_constraints")) {
        return {
          rows: [
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "CUSTOMERS",
              CONSTRAINT_NAME: "CUSTOMERS_PK",
              CONSTRAINT_TYPE: "P",
              SEARCH_CONDITION: null,
              R_OWNER: null,
              R_CONSTRAINT_NAME: null,
              REFERENCED_TABLE_NAME: null,
              COLUMN_NAME: "CUSTOMER_ID",
              POSITION: 1
            },
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "CUSTOMERS",
              CONSTRAINT_NAME: "CUSTOMERS_EMAIL_UK",
              CONSTRAINT_TYPE: "U",
              SEARCH_CONDITION: null,
              R_OWNER: null,
              R_CONSTRAINT_NAME: null,
              REFERENCED_TABLE_NAME: null,
              COLUMN_NAME: "CUSTOMER_EMAIL",
              POSITION: 1
            },
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "ORDERS",
              CONSTRAINT_NAME: "ORDERS_CUSTOMER_FK",
              CONSTRAINT_TYPE: "R",
              SEARCH_CONDITION: null,
              R_OWNER: "ERP_OWNER",
              R_CONSTRAINT_NAME: "CUSTOMERS_PK",
              REFERENCED_TABLE_NAME: "CUSTOMERS",
              COLUMN_NAME: "CUSTOMER_ID",
              POSITION: 1
            },
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "CUSTOMERS",
              CONSTRAINT_NAME: "CUSTOMERS_STATUS_CK",
              CONSTRAINT_TYPE: "C",
              SEARCH_CONDITION: "STATUS IN ('A','I')",
              R_OWNER: null,
              R_CONSTRAINT_NAME: null,
              REFERENCED_TABLE_NAME: null,
              COLUMN_NAME: null,
              POSITION: null
            },
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "CUSTOMERS",
              CONSTRAINT_NAME: "CUSTOMERS_NAME_NN",
              CONSTRAINT_TYPE: "C",
              SEARCH_CONDITION: "\"CUSTOMER_NAME\" IS NOT NULL",
              R_OWNER: null,
              R_CONSTRAINT_NAME: null,
              REFERENCED_TABLE_NAME: null,
              COLUMN_NAME: "CUSTOMER_NAME",
              POSITION: null
            }
          ] as Row[]
        };
      }

      if (sql.includes("FROM all_indexes")) {
        return {
          rows: [
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "CUSTOMERS",
              INDEX_NAME: "CUSTOMERS_PK",
              UNIQUENESS: "UNIQUE",
              COLUMN_NAME: "CUSTOMER_ID",
              COLUMN_POSITION: 1
            },
            {
              OWNER: "ERP_OWNER",
              TABLE_NAME: "CUSTOMERS",
              INDEX_NAME: "CUSTOMERS_NAME_IDX",
              UNIQUENESS: "NONUNIQUE",
              COLUMN_NAME: "CUSTOMER_NAME",
              COLUMN_POSITION: 1
            }
          ] as Row[]
        };
      }

      if (sql.includes("FROM all_sequences")) {
        return {
          rows: [
            {
              SEQUENCE_OWNER: "ERP_OWNER",
              SEQUENCE_NAME: "CUSTOMERS_SEQ"
            }
          ] as Row[]
        };
      }

      if (sql.includes("FROM all_procedures")) {
        return {
          rows: [
            {
              OWNER: "ERP_OWNER",
              OBJECT_NAME: "PKG_CUSTOMER_API",
              PROCEDURE_NAME: "GET_CUSTOMERS",
              OBJECT_TYPE: "PACKAGE"
            },
            {
              OWNER: "ERP_OWNER",
              OBJECT_NAME: "PKG_CUSTOMER_API",
              PROCEDURE_NAME: "UPSERT_CUSTOMER",
              OBJECT_TYPE: "PACKAGE"
            },
            {
              OWNER: "ERP_OWNER",
              OBJECT_NAME: "CALCULATE_SCORE",
              PROCEDURE_NAME: null,
              OBJECT_TYPE: "FUNCTION"
            }
          ] as Row[]
        };
      }

      if (sql.includes("FROM all_arguments")) {
        return {
          rows: [
            {
              OWNER: "ERP_OWNER",
              PACKAGE_NAME: "PKG_CUSTOMER_API",
              OBJECT_NAME: "GET_CUSTOMERS",
              ARGUMENT_NAME: "P_STATUS",
              POSITION: 1,
              IN_OUT: "IN",
              DATA_TYPE: "VARCHAR2",
              TYPE_NAME: null
            },
            {
              OWNER: "ERP_OWNER",
              PACKAGE_NAME: "PKG_CUSTOMER_API",
              OBJECT_NAME: "GET_CUSTOMERS",
              ARGUMENT_NAME: "P_RESULT",
              POSITION: 2,
              IN_OUT: "OUT",
              DATA_TYPE: "REF CURSOR",
              TYPE_NAME: null
            },
            {
              OWNER: "ERP_OWNER",
              PACKAGE_NAME: "PKG_CUSTOMER_API",
              OBJECT_NAME: "UPSERT_CUSTOMER",
              ARGUMENT_NAME: "P_CUSTOMER_ID",
              POSITION: 1,
              IN_OUT: "IN/OUT",
              DATA_TYPE: "NUMBER",
              TYPE_NAME: null
            },
            {
              OWNER: "ERP_OWNER",
              PACKAGE_NAME: null,
              OBJECT_NAME: "CALCULATE_SCORE",
              ARGUMENT_NAME: null,
              POSITION: 0,
              IN_OUT: "OUT",
              DATA_TYPE: "NUMBER",
              TYPE_NAME: null
            },
            {
              OWNER: "ERP_OWNER",
              PACKAGE_NAME: null,
              OBJECT_NAME: "CALCULATE_SCORE",
              ARGUMENT_NAME: "P_CUSTOMER_ID",
              POSITION: 1,
              IN_OUT: "IN",
              DATA_TYPE: "NUMBER",
              TYPE_NAME: null
            }
          ] as Row[]
        };
      }

      if (sql.includes("o.object_type IN ('PACKAGE', 'PROCEDURE', 'FUNCTION')")) {
        return {
          rows: [
            {
              OWNER: "ERP_OWNER",
              OBJECT_NAME: "PKG_CUSTOMER_API",
              OBJECT_TYPE: "PACKAGE",
              STATUS: "INVALID"
            },
            {
              OWNER: "ERP_OWNER",
              OBJECT_NAME: "CALCULATE_SCORE",
              OBJECT_TYPE: "FUNCTION",
              STATUS: "VALID"
            }
          ] as Row[]
        };
      }

      return {
        rows: [
          {
            OWNER: "ERP_OWNER",
            OBJECT_NAME: "CUSTOMERS",
            OBJECT_TYPE: "TABLE",
            STATUS: "VALID"
          },
          {
            OWNER: "ERP_OWNER",
            OBJECT_NAME: "VW_CUSTOMER_SUMMARY",
            OBJECT_TYPE: "VIEW",
            STATUS: "VALID"
          },
          {
            OWNER: "ERP_OWNER",
            OBJECT_NAME: "ORDERS",
            OBJECT_TYPE: "TABLE",
            STATUS: "VALID"
          }
        ] as Row[]
      };
    },
    execute: vi.fn(async () => ({ rows: [] })),
    executePlsqlBlock: vi.fn(async () => ({ rows: [] })),
    executeProcedure: vi.fn(async () => ({ rows: [] }))
  };
}

describe("Oracle schema inspector", () => {
  it("inspects owner-filtered tables, views, and columns", async () => {
    const adapter = createMockAdapter();
    const { store } = createStore(connectionRecord());
    const inspector = createOracleSchemaInspector({
      store,
      adapterFactory: () => adapter,
      resolvePassword: () => "resolved-password",
      capturedBy: "test"
    });

    const result = await inspector.inspectOracleSchema("conn-1", "erp_owner");

    expect(adapter.openConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "erp_api",
        password: "resolved-password",
        connectString: "localhost:1521/ERPDB"
      })
    );
    expect(adapter.queryCalls).toEqual([
      {
        sql: expect.stringContaining("FROM all_objects"),
        binds: { owner: "ERP_OWNER" },
        options: { outFormat: "object" }
      },
      {
        sql: expect.stringContaining("FROM all_tab_columns"),
        binds: { owner: "ERP_OWNER" },
        options: { outFormat: "object" }
      },
      {
        sql: expect.stringContaining("FROM all_constraints"),
        binds: { owner: "ERP_OWNER" },
        options: { outFormat: "object" }
      },
      {
        sql: expect.stringContaining("FROM all_indexes"),
        binds: { owner: "ERP_OWNER" },
        options: { outFormat: "object" }
      },
      {
        sql: expect.stringContaining("FROM all_sequences"),
        binds: { owner: "ERP_OWNER" },
        options: { outFormat: "object" }
      },
      {
        sql: expect.stringContaining("FROM all_procedures"),
        binds: { owner: "ERP_OWNER" },
        options: { outFormat: "object" }
      },
      {
        sql: expect.stringContaining("FROM all_arguments"),
        binds: { owner: "ERP_OWNER" },
        options: { outFormat: "object" }
      },
      {
        sql: expect.stringContaining("o.object_type IN ('PACKAGE', 'PROCEDURE', 'FUNCTION')"),
        binds: { owner: "ERP_OWNER" },
        options: { outFormat: "object" }
      }
    ]);
    expect(result.snapshot.objects).toHaveLength(3);
    expect(result.snapshot.objects[0]).toMatchObject({
      owner: "ERP_OWNER",
      objectName: "CUSTOMERS",
      objectType: "TABLE",
      objectStatus: "VALID"
    });
    expect(result.snapshot.objects[0].columns[0]).toEqual({
      name: "CUSTOMER_ID",
      oracleType: "NUMBER",
      nullable: false,
      dataLength: 22,
      precision: 10,
      scale: 0,
      charLength: 0,
      dataDefault: null
    });
    expect(result.snapshot.objects[0].constraints).toEqual(
      expect.arrayContaining([
        {
          name: "CUSTOMERS_PK",
          type: "PRIMARY_KEY",
          columns: ["CUSTOMER_ID"],
          searchCondition: null,
          referencedOwner: null,
          referencedObjectName: null,
          referencedConstraintName: null
        },
        {
          name: "CUSTOMERS_EMAIL_UK",
          type: "UNIQUE",
          columns: ["CUSTOMER_EMAIL"],
          searchCondition: null,
          referencedOwner: null,
          referencedObjectName: null,
          referencedConstraintName: null
        },
        {
          name: "CUSTOMERS_STATUS_CK",
          type: "CHECK",
          columns: [],
          searchCondition: "STATUS IN ('A','I')",
          referencedOwner: null,
          referencedObjectName: null,
          referencedConstraintName: null
        },
        {
          name: "CUSTOMERS_NAME_NN",
          type: "NOT_NULL",
          columns: ["CUSTOMER_NAME"],
          searchCondition: "\"CUSTOMER_NAME\" IS NOT NULL",
          referencedOwner: null,
          referencedObjectName: null,
          referencedConstraintName: null
        }
      ])
    );
    expect(result.snapshot.objects[0].indexes).toEqual(
      expect.arrayContaining([
        {
          name: "CUSTOMERS_PK",
          unique: true,
          columns: ["CUSTOMER_ID"]
        },
        {
          name: "CUSTOMERS_NAME_IDX",
          unique: false,
          columns: ["CUSTOMER_NAME"]
        }
      ])
    );
    expect(result.snapshot.objects[2].constraints).toEqual([
      {
        name: "ORDERS_CUSTOMER_FK",
        type: "FOREIGN_KEY",
        columns: ["CUSTOMER_ID"],
        searchCondition: null,
        referencedOwner: "ERP_OWNER",
        referencedObjectName: "CUSTOMERS",
        referencedConstraintName: "CUSTOMERS_PK"
      }
    ]);
    expect(result.storedSnapshot).toMatchObject({
      apiConnectionId: "conn-1",
      oracleOwner: "ERP_OWNER"
    });
    expect(adapter.close).toHaveBeenCalledTimes(1);
  });

  it("persists the inspected snapshot in oracle_schema_snapshots", async () => {
    const { store, snapshots } = createStore(connectionRecord());
    const inspector = createOracleSchemaInspector({
      store,
      adapterFactory: createMockAdapter
    });

    await inspector.inspectOracleSchema("conn-1", "ERP_OWNER");

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].owner).toBe("ERP_OWNER");
    expect(snapshots[0].objects.map((object) => object.objectName)).toEqual([
      "CUSTOMERS",
      "VW_CUSTOMER_SUMMARY",
      "ORDERS"
    ]);
    expect(snapshots[0].sequences).toEqual([{ owner: "ERP_OWNER", name: "CUSTOMERS_SEQ" }]);
    expect(snapshots[0].programUnits.map((unit) => unit.name)).toEqual([
      "GET_CUSTOMERS",
      "UPSERT_CUSTOMER",
      "CALCULATE_SCORE"
    ]);
  });

  it("discovers sequences", async () => {
    const result = await inspectMockSchema();

    expect(result.snapshot.sequences).toEqual([{ owner: "ERP_OWNER", name: "CUSTOMERS_SEQ" }]);
  });

  it("discovers package procedures", async () => {
    const result = await inspectMockSchema();

    expect(result.snapshot.programUnits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "ERP_OWNER",
          packageName: "PKG_CUSTOMER_API",
          name: "GET_CUSTOMERS",
          unitType: "PACKAGE_PROCEDURE"
        })
      ])
    );
  });

  it("discovers IN and IN/OUT params", async () => {
    const result = await inspectMockSchema();
    const upsert = result.snapshot.programUnits.find((unit) => unit.name === "UPSERT_CUSTOMER");
    const getCustomers = result.snapshot.programUnits.find((unit) => unit.name === "GET_CUSTOMERS");

    expect(getCustomers?.arguments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "P_STATUS",
          position: 1,
          direction: "IN",
          oracleType: "VARCHAR2"
        })
      ])
    );
    expect(upsert?.arguments).toEqual([
      expect.objectContaining({
        name: "P_CUSTOMER_ID",
        position: 1,
        direction: "IN/OUT",
        oracleType: "NUMBER"
      })
    ]);
  });

  it("discovers SYS_REFCURSOR OUT params", async () => {
    const result = await inspectMockSchema();
    const getCustomers = result.snapshot.programUnits.find((unit) => unit.name === "GET_CUSTOMERS");

    expect(getCustomers?.arguments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "P_RESULT",
          position: 2,
          direction: "OUT",
          oracleType: "REF CURSOR",
          isSysRefCursor: true
        })
      ])
    );
  });

  it("captures invalid package object status", async () => {
    const result = await inspectMockSchema();
    const getCustomers = result.snapshot.programUnits.find((unit) => unit.name === "GET_CUSTOMERS");

    expect(getCustomers?.objectStatus).toBe("INVALID");
  });

  it("captures a table primary key", async () => {
    const result = await inspectMockSchema();
    const customers = result.snapshot.objects.find((object) => object.objectName === "CUSTOMERS");

    expect(customers?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "CUSTOMERS_PK",
          type: "PRIMARY_KEY",
          columns: ["CUSTOMER_ID"]
        })
      ])
    );
  });

  it("captures a table unique constraint", async () => {
    const result = await inspectMockSchema();
    const customers = result.snapshot.objects.find((object) => object.objectName === "CUSTOMERS");

    expect(customers?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "CUSTOMERS_EMAIL_UK",
          type: "UNIQUE",
          columns: ["CUSTOMER_EMAIL"]
        })
      ])
    );
  });

  it("captures a table foreign key", async () => {
    const result = await inspectMockSchema();
    const orders = result.snapshot.objects.find((object) => object.objectName === "ORDERS");

    expect(orders?.constraints).toEqual([
      expect.objectContaining({
        name: "ORDERS_CUSTOMER_FK",
        type: "FOREIGN_KEY",
        columns: ["CUSTOMER_ID"],
        referencedOwner: "ERP_OWNER",
        referencedObjectName: "CUSTOMERS",
        referencedConstraintName: "CUSTOMERS_PK"
      })
    ]);
  });

  it("captures check and not-null constraints", async () => {
    const result = await inspectMockSchema();
    const customers = result.snapshot.objects.find((object) => object.objectName === "CUSTOMERS");

    expect(customers?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "CUSTOMERS_STATUS_CK",
          type: "CHECK",
          searchCondition: "STATUS IN ('A','I')"
        }),
        expect.objectContaining({
          name: "CUSTOMERS_NAME_NN",
          type: "NOT_NULL",
          columns: ["CUSTOMER_NAME"]
        })
      ])
    );
  });

  it("captures indexed columns", async () => {
    const result = await inspectMockSchema();
    const customers = result.snapshot.objects.find((object) => object.objectName === "CUSTOMERS");

    expect(customers?.indexes).toEqual(
      expect.arrayContaining([
        {
          name: "CUSTOMERS_PK",
          unique: true,
          columns: ["CUSTOMER_ID"]
        },
        {
          name: "CUSTOMERS_NAME_IDX",
          unique: false,
          columns: ["CUSTOMER_NAME"]
        }
      ])
    );
  });

  it("fails when the connection does not exist", async () => {
    const { store } = createStore(connectionRecord());
    store.apiConnection.findUnique = async () => null;
    const inspector = createOracleSchemaInspector({
      store,
      adapterFactory: createMockAdapter
    });

    await expect(inspector.inspectOracleSchema("missing", "ERP_OWNER")).rejects.toThrow(
      "Oracle connection not found"
    );
  });
});
