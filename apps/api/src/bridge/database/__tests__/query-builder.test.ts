import { describe, expect, it } from "vitest";
import { buildSelectQuery } from "../query-builder.js";
import type { ResolvedApiContract } from "../../contracts/index.js";

function getTestContract(): ResolvedApiContract {
  return {
    id: "c1",
    version: 1,
    resource: "users",
    endpoint: "/users",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "users_1", schemaVersion: "1" },
    source: {
      database: "db1",
      owner: "MYSCHEMA",
      type: "table",
      name: "USERS_TABLE"
    },
    operations: [{ operation: "read", enabled: true }],
    fields: [
      {
        apiField: "id",
        apiType: "number",
        oracleType: "number",
        dbColumn: "ID"
      },
      {
        apiField: "name",
        apiType: "string",
        oracleType: "varchar2",
        dbColumn: "NAME"
      },
      {
        apiField: "password",
        apiType: "string",
        oracleType: "varchar2",
        dbColumn: "PASSWORD",
        writeOnly: true
      }
    ]
  };
}

describe("Oracle Query Builder", () => {
  it("1. Simple SELECT generated.", () => {
    const contract = getTestContract();
    const result = buildSelectQuery(contract, {});

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE"`);
    expect(result.binds).toEqual({});
  });

  it("2. Filter eq uses bind variable.", () => {
    const contract = getTestContract();
    const result = buildSelectQuery(contract, {
      filters: [{ field: "name", operator: "eq", value: "Alice" }]
    });

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE" WHERE "NAME" = :p1`);
    expect(result.binds).toEqual({ p1: "Alice" });
  });

  it("3. IN uses bind variables.", () => {
    const contract = getTestContract();
    const result = buildSelectQuery(contract, {
      filters: [{ field: "id", operator: "in", value: [1, 2, 3] }]
    });

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE" WHERE "ID" IN (:p1_0, :p1_1, :p1_2)`);
    expect(result.binds).toEqual({
      p1_0: 1,
      p1_1: 2,
      p1_2: 3
    });
  });

  it("4. Unknown filter rejected.", () => {
    const contract = getTestContract();
    expect(() =>
      buildSelectQuery(contract, {
        filters: [{ field: "unknown_field", operator: "eq", value: "x" }]
      })
    ).toThrowError("Unknown filter field: unknown_field");
  });

  it("5. Unknown sort rejected.", () => {
    const contract = getTestContract();
    expect(() =>
      buildSelectQuery(contract, {
        sorts: [{ field: "unknown_sort", direction: "asc" }]
      })
    ).toThrowError("Unknown sort field: unknown_sort");
  });

  it("6. Unmapped columns are not selected.", () => {
    const contract = getTestContract();
    const result = buildSelectQuery(contract, {});

    expect(result.sql).not.toContain("PASSWORD");
    expect(result.sql).toContain("ID");
    expect(result.sql).toContain("NAME");
  });

  it("rejects unsupported operators.", () => {
    const contract = getTestContract();
    expect(() =>
      buildSelectQuery(contract, {
        filters: [{ field: "name", operator: "unsupported", value: "x" }]
      })
    ).toThrowError("Unsupported filter operator: unsupported");
  });

  it("applies default sort if configured.", () => {
    const contract = getTestContract();
    contract.sorts = [{ field: "id", directions: ["desc"] }];
    const result = buildSelectQuery(contract, {});

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE" ORDER BY "ID" DESC`);
  });

  it("adds pagination fetch and offset", () => {
    const contract = getTestContract();
    const result = buildSelectQuery(contract, { limit: 10, offset: 20 });

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE" OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`);
    expect(result.binds).toEqual({ offset: 20, limit: 10 });
  });
});
