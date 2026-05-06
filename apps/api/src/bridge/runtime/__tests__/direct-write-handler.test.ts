import { describe, expect, it, vi } from "vitest";
import {
  createDirectWriteHandler,
  type DirectWriteHandlerContext
} from "../direct-write-handler.js";
import type { ContractCache } from "../../contracts/contract-cache.js";
import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleConnectorAdapter } from "../../connections/oracle-adapter.js";
import { createPermissiveChecker } from "../permissions.js";
import { testOracleBindTypes, type OracleBindTypeRegistry } from "../oracle-helpers.js";

const numericOracleBindTypes: OracleBindTypeRegistry = {
  string: 2001,
  number: 2002,
  date: 2011,
  timestamp: 2012,
  cursor: 2004,
  buffer: 2007,
  clob: 2017,
  blob: 2019
};

/**
 * Example contract: MYSCHEMA.DEPARTMENTS table
 *
 *   ID        NUMBER       — PK, readOnly
 *   DEPT_NAME VARCHAR2(50) — writable
 *   LOCATION  VARCHAR2(50) — writable
 */
function makeContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c-direct-1",
    resource: "departments",
    version: 1,
    endpoint: "/api/departments",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "dept_v1", schemaVersion: "1" },
    source: { database: "db1", owner: "MYSCHEMA", type: "table", name: "DEPARTMENTS" },
    fields: [
      { apiField: "id",       apiType: "integer", oracleType: "number",   dbColumn: "ID", readOnly: true },
      { apiField: "deptName", apiType: "string",  oracleType: "varchar2", dbColumn: "DEPT_NAME" },
      { apiField: "location", apiType: "string",  oracleType: "varchar2", dbColumn: "LOCATION" }
    ],
    operations: [
      { operation: "create", enabled: true, mode: "direct_table" },
      { operation: "update", enabled: true, mode: "direct_table" }
    ],
    idGeneration: { strategy: "sequence", sequenceName: "DEPT_SEQ" },
    ...overrides
  };
}

function makeCache(contract: ResolvedApiContract | undefined): ContractCache {
  return {
    getContractByEndpoint: (_method, path) =>
      path === "/api/departments" ? contract : undefined,
    loadActiveContracts: vi.fn(),
    reloadContract: vi.fn(),
    reloadAllContracts: vi.fn()
  };
}

function makeAdapter(): OracleConnectorAdapter {
  return {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 1 }),
    executePlsqlBlock: vi.fn(),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

function makeCtx(overrides: Partial<DirectWriteHandlerContext> = {}): DirectWriteHandlerContext {
  return {
    cache: makeCache(makeContract()),
    adapter: makeAdapter(),
    permissions: createPermissiveChecker(),
    oracleBindTypes: testOracleBindTypes,
    ...overrides
  };
}

describe("DirectWriteHandler", () => {
  it("1. Direct create disabled by default.", async () => {
    // Contract with create enabled but NO mode set (defaults to package_procedure)
    const contract = makeContract({
      operations: [
        { operation: "create", enabled: true }   // no mode
      ]
    });
    const handle = createDirectWriteHandler(makeCtx({ cache: makeCache(contract) }));

    const { status, body } = await handle({
      contractPath: "/api/departments",
      method: "POST",
      body: { deptName: "Engineering" }
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("Direct table writes are not enabled");
  });

  it("2. Direct create with sequence generates correct SQL.", async () => {
    const adapter = makeAdapter();
    (adapter.execute as any).mockResolvedValue({ rows: [], rowsAffected: 1, outBinds: { generatedId: 99 } });
    const handle = createDirectWriteHandler(makeCtx({ adapter }));

    const { body } = await handle({
      contractPath: "/api/departments",
      method: "POST",
      body: { deptName: "Engineering", location: "Building A" }
    });

    const sql = (adapter.execute as any).mock.calls[0][0] as string;

    expect(sql).toContain("DEPT_SEQ.NEXTVAL");
    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain('"MYSCHEMA"."DEPARTMENTS"');
    expect(sql).toContain('"ID"');
    expect(sql).toContain('"DEPT_NAME"');
    expect(sql).toContain('"LOCATION"');
    expect(sql).toContain('RETURNING "ID" INTO :generatedId');

    const binds = (adapter.execute as any).mock.calls[0][1];
    expect(binds.p1).toBe("Engineering");
    expect(binds.p2).toBe("Building A");
    expect(binds.generatedId).toEqual({ dir: "out", type: "number" });

    // Generated ID must be returned in the response.
    expect((body as any).data.id).toBe(99);
  });

  it("3. Direct create with trigger uses configured RETURNING strategy.", async () => {
    const contract = makeContract({
      idGeneration: { strategy: "trigger", returningColumn: "DEPT_ID" }
    });
    const adapter = makeAdapter();
    (adapter.execute as any).mockResolvedValue({
      rows: [],
      rowsAffected: 1,
      outBinds: { generatedId: 42 }
    });
    const handle = createDirectWriteHandler(makeCtx({
      cache: makeCache(contract),
      adapter
    }));

    const { status, body } = await handle({
      contractPath: "/api/departments",
      method: "POST",
      body: { deptName: "Sales" }
    });

    expect(status).toBe(201);

    const sql = (adapter.execute as any).mock.calls[0][0] as string;
    expect(sql).toContain('RETURNING "DEPT_ID" INTO :generatedId');
    expect(sql).not.toContain("NEXTVAL");

    const binds = (adapter.execute as any).mock.calls[0][1];
    expect(binds.generatedId).toEqual({ dir: "out", type: "number" });

    // Generated ID must be mapped to the readOnly PK field in the response.
    expect((body as any).data.id).toBe(42);
  });

  it("trigger RETURNING bind uses configured driver bind constant.", async () => {
    const contract = makeContract({
      idGeneration: { strategy: "trigger", returningColumn: "DEPT_ID" }
    });
    const adapter = makeAdapter();
    (adapter.execute as any).mockResolvedValue({
      rows: [],
      rowsAffected: 1,
      outBinds: { generatedId: 42 }
    });
    const handle = createDirectWriteHandler(makeCtx({
      cache: makeCache(contract),
      adapter,
      oracleBindTypes: numericOracleBindTypes
    }));

    await handle({
      contractPath: "/api/departments",
      method: "POST",
      body: { deptName: "Sales" }
    });

    const binds = (adapter.execute as any).mock.calls[0][1];
    expect(binds.generatedId).toEqual({ dir: "out", type: numericOracleBindTypes.number });
  });

  it("4. Direct update rejects read-only field.", async () => {
    const handle = createDirectWriteHandler(makeCtx());

    const { status, body } = await handle({
      contractPath: "/api/departments",
      method: "PATCH",
      body: { id: 999, deptName: "Hacked" },
      idParam: "1"
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("read-only");
  });

  it("5. Unknown field rejected.", async () => {
    const handle = createDirectWriteHandler(makeCtx());

    const { status, body } = await handle({
      contractPath: "/api/departments",
      method: "POST",
      body: { deptName: "Valid", hackerField: "drop table" }
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("Unknown field: hackerField");
  });

  it("6. Oracle error translated.", async () => {
    const adapter = makeAdapter();
    (adapter.execute as any).mockRejectedValue(
      new Error("ORA-00001: unique constraint (MYSCHEMA.DEPT_NAME_UK) violated")
    );
    const handle = createDirectWriteHandler(makeCtx({ adapter }));

    const { status, body } = await handle({
      contractPath: "/api/departments",
      method: "POST",
      body: { deptName: "Duplicate" }
    });

    expect(status).toBe(409);
    expect((body as any).code).toBe("UNIQUE_CONSTRAINT");
    expect((body as any).error).not.toContain("ORA-00001");
  });

  it("update generates correct UPDATE SQL.", async () => {
    const adapter = makeAdapter();
    const handle = createDirectWriteHandler(makeCtx({ adapter }));

    const { status } = await handle({
      contractPath: "/api/departments",
      method: "PATCH",
      body: { deptName: "Renamed" },
      idParam: "7"
    });

    expect(status).toBe(200);

    const sql = (adapter.execute as any).mock.calls[0][0] as string;
    expect(sql).toContain("UPDATE");
    expect(sql).toContain('"DEPT_NAME" = :p1');
    expect(sql).toContain('WHERE "ID" = :pkValue');

    const binds = (adapter.execute as any).mock.calls[0][1];
    expect(binds.p1).toBe("Renamed");
    expect(binds.pkValue).toBe("7");
  });

  it("update returns 404 when no rows affected.", async () => {
    const adapter = makeAdapter();
    (adapter.execute as any).mockResolvedValue({ rows: [], rowsAffected: 0 });
    const handle = createDirectWriteHandler(makeCtx({ adapter }));

    const { status, body } = await handle({
      contractPath: "/api/departments",
      method: "PATCH",
      body: { deptName: "Ghost" },
      idParam: "99999"
    });

    expect(status).toBe(404);
    expect((body as any).error).toContain("Not found");
  });
});
