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

  it("7. rejects unsupported operators.", () => {
    const contract = getTestContract();
    expect(() =>
      buildSelectQuery(contract, {
        filters: [{ field: "name", operator: "unsupported", value: "x" }]
      })
    ).toThrowError("Unsupported filter operator: unsupported");
  });

  it("8. applies default sort if configured.", () => {
    const contract = getTestContract();
    contract.sorts = [{ field: "id", directions: ["desc"] }];
    const result = buildSelectQuery(contract, {});

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE" ORDER BY "ID" DESC`);
  });

  it("9. adds pagination fetch and offset", () => {
    const contract = getTestContract();
    const result = buildSelectQuery(contract, { limit: 10, offset: 20 });

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE" OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`);
    expect(result.binds).toEqual({ offset: 20, limit: 10 });
  });

  it("10. generates offsetFetch pagination SQL for 19c", () => {
    const contract = getTestContract();
    contract.pagination = {
      defaultLimit: 25,
      maxLimit: 100,
      strategy: "offsetFetch"
    };

    const result = buildSelectQuery(contract, { limit: 10, offset: 20 }, { paginationStrategy: "offsetFetch" });

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE" OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`);
    expect(result.binds).toEqual({ limit: 10, offset: 20 });
  });

  it("11. generates rownum pagination SQL for 11g", () => {
    const contract = getTestContract();
    contract.pagination = {
      defaultLimit: 25,
      maxLimit: 100,
      strategy: "rownum"
    };

    const result = buildSelectQuery(contract, { limit: 10, offset: 20 }, { paginationStrategy: "rownum" });

    expect(result.sql).toBe(
      `SELECT * FROM ( SELECT a.*, ROWNUM rnum FROM (SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE") a WHERE ROWNUM <= (:offset + :limit) ) WHERE rnum > :offset`
    );
    expect(result.binds).toEqual({ limit: 10, offset: 20 });
  });

  it("12. clamps maxLimit instead of throwing", () => {
    const contract = getTestContract();
    contract.pagination = {
      defaultLimit: 25,
      maxLimit: 50,
      strategy: "offsetFetch"
    };

    const result = buildSelectQuery(contract, { limit: 51 });
    expect(result.binds.limit).toBe(50);
  });

  it("13. applies defaultLimit", () => {
    const contract = getTestContract();
    contract.pagination = {
      defaultLimit: 25,
      maxLimit: 100,
      strategy: "offsetFetch"
    };

    const result = buildSelectQuery(contract, {});

    expect(result.sql).toBe(`SELECT "ID", "NAME" FROM "MYSCHEMA"."USERS_TABLE" OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`);
    expect(result.binds).toEqual({ limit: 25, offset: 0 });
  });

  it("14. limit and offset use bind variables", () => {
    const contract = getTestContract();
    contract.pagination = {
      defaultLimit: 25,
      maxLimit: 100,
      strategy: "offsetFetch"
    };

    const result = buildSelectQuery(contract, { limit: 10, offset: 5 });

    expect(result.sql).toContain(":offset");
    expect(result.sql).toContain(":limit");
    expect(result.sql).not.toContain("OFFSET 5");
    expect(result.sql).not.toContain("NEXT 10");
    expect(result.binds).toEqual({ limit: 10, offset: 5 });
  });

  it("15. rejects filters and sorts on write-only fields", () => {
    const contract = getTestContract();
    
    expect(() =>
      buildSelectQuery(contract, {
        filters: [{ field: "password", operator: "eq", value: "secret" }]
      })
    ).toThrowError("Unknown filter field: password");

    expect(() =>
      buildSelectQuery(contract, {
        sorts: [{ field: "password", direction: "asc" }]
      })
    ).toThrowError("Unknown sort field: password");
  });

  it("16. contains operator uses ESCAPE '\\'", () => {
    const contract = getTestContract();
    const result = buildSelectQuery(contract, {
      filters: [{ field: "name", operator: "contains", value: "50% off_" }]
    });

    expect(result.sql).toContain(`"NAME" LIKE :p1 ESCAPE '\\'`);
    expect(result.binds).toEqual({ p1: "%50\\% off\\_%" });
  });

  it("17. rejects identifiers with quotes or null bytes", () => {
    const contract = getTestContract();
    contract.source.owner = 'HACK"SCHEMA';
    
    expect(() => buildSelectQuery(contract, {})).toThrowError("cannot contain double quotes");
  });

  it("18. rejects invalid sort directions", () => {
    const contract = getTestContract();
    
    expect(() =>
      buildSelectQuery(contract, {
        sorts: [{ field: "id", direction: "up" as any }]
      })
    ).toThrowError("Invalid sort direction: up");
  });
  it("19. pagination strategy precedence respects options over contract over default", () => {
    const contract = getTestContract();
    
    // 1. Contract specifies "offsetFetch", option specifies "rownum" -> rownum
    contract.pagination = { defaultLimit: 10, maxLimit: 100, strategy: "offsetFetch" };
    let result = buildSelectQuery(contract, { limit: 5, offset: 0 }, { paginationStrategy: "rownum" });
    expect(result.sql).toContain("ROWNUM <=");

    // 2. Contract specifies "rownum", option specifies "offsetFetch" -> offsetFetch
    contract.pagination = { defaultLimit: 10, maxLimit: 100, strategy: "rownum" };
    result = buildSelectQuery(contract, { limit: 5, offset: 0 }, { paginationStrategy: "offsetFetch" });
    expect(result.sql).toContain("OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY");

    // 3. Contract specifies "rownum", option specifies nothing -> rownum
    contract.pagination = { defaultLimit: 10, maxLimit: 100, strategy: "rownum" };
    result = buildSelectQuery(contract, { limit: 5, offset: 0 });
    expect(result.sql).toContain("ROWNUM <=");

    // 4. Contract specifies nothing, option specifies nothing -> offsetFetch (default fallback)
    contract.pagination = { defaultLimit: 10, maxLimit: 100 } as any;
    result = buildSelectQuery(contract, { limit: 5, offset: 0 });
    expect(result.sql).toContain("OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY");
  });
});
