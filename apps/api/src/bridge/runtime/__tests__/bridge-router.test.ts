import { describe, expect, it, vi } from "vitest";
import { createBridgeDispatcher, type BridgeRouterContext } from "../bridge-router.js";
import type { ContractCache } from "../../contracts/contract-cache.js";
import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleConnectorAdapter } from "../../connections/oracle-adapter.js";
import { createPermissiveChecker } from "../permissions.js";
import { testOracleBindTypes } from "../oracle-helpers.js";
import type { CursorLike } from "../cursor-read-handler.js";

const NOW = new Date("2026-05-23T00:00:00.000Z");

function baseContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c1",
    resource: "employees",
    version: 1,
    endpoint: "/employees",
    status: "active",
    publishedAt: NOW,
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees:v1", schemaVersion: "1" },
    source: { database: "db1", owner: "HR", type: "table", name: "EMPLOYEES" },
    fields: [
      { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID", readOnly: true },
      { apiField: "name", apiType: "string", oracleType: "varchar2", dbColumn: "FULL_NAME" }
    ],
    operations: [
      { operation: "list", enabled: true },
      { operation: "read", enabled: true }
    ],
    ...overrides
  };
}

function procedureContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return baseContract({
    source: {
      database: "db1",
      owner: "HR",
      type: "package",
      packageName: "PKG_EMP",
      procedureName: "SAVE_EMP"
    },
    fields: [
      { apiField: "name", apiType: "string", oracleType: "varchar2" },
      { apiField: "id", apiType: "integer", oracleType: "number", readOnly: true }
    ],
    operations: [
      { operation: "create", enabled: true },
      { operation: "update", enabled: true }
    ],
    procedureParams: [
      { paramName: "P_NAME", direction: "in", apiField: "name", oracleType: "varchar2", required: true },
      { paramName: "P_ID", direction: "out", apiField: "id", oracleType: "number" }
    ],
    ...overrides
  });
}

function cursorContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return procedureContract({
    operations: [{ operation: "list", enabled: true }],
    procedureParams: [
      { paramName: "P_RESULT", direction: "out", oracleType: "sys_refcursor" }
    ],
    sysRefCursor: {
      paramName: "P_RESULT",
      fields: [
        { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID" },
        { apiField: "name", apiType: "string", oracleType: "varchar2", dbColumn: "FULL_NAME" }
      ]
    },
    ...overrides
  });
}

function directContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return baseContract({
    operations: [
      { operation: "create", enabled: true, mode: "direct_table" },
      { operation: "update", enabled: true, mode: "direct_table" }
    ],
    idGeneration: { strategy: "sequence", sequenceName: "EMP_SEQ" },
    ...overrides
  });
}

function makeCache(contract?: ResolvedApiContract): ContractCache {
  return {
    getContractByEndpoint: vi.fn((_method, path) => path === "/employees" ? contract : undefined),
    loadActiveContracts: vi.fn(),
    reloadContract: vi.fn(),
    reloadAllContracts: vi.fn()
  };
}

function makeCursor(rows: Record<string, unknown>[]): CursorLike {
  let done = false;
  return {
    getRows: vi.fn(async () => {
      if (done) return [];
      done = true;
      return rows;
    }),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

function makeAdapter(cursor = makeCursor([])): OracleConnectorAdapter {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }] }),
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 1, outBinds: { generatedId: 10 } }),
    executePlsqlBlock: vi.fn().mockResolvedValue({ rows: [], outBinds: { P_ID: 10, P_RESULT: cursor } }),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

function makeCtx(contract?: ResolvedApiContract, adapter = makeAdapter()): BridgeRouterContext {
  return {
    cache: makeCache(contract),
    adapter,
    permissions: createPermissiveChecker(),
    oracleBindTypes: testOracleBindTypes
  };
}

describe("Bridge runtime router dispatch", () => {
  it("GET list routes still dispatch to the read handler.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(baseContract(), adapter));

    const result = await dispatch({ method: "GET", contractPath: "/employees" });

    expect(result.status).toBe(200);
    expect(adapter.query).toHaveBeenCalledOnce();
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });

  it("POST package/procedure contracts dispatch to the write handler.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(procedureContract(), adapter));

    const result = await dispatch({ method: "POST", contractPath: "/employees", body: { name: "Alice" } });

    expect(result.status).toBe(201);
    expect(adapter.executePlsqlBlock).toHaveBeenCalledOnce();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("PATCH package/procedure contracts dispatch to the write handler as update.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(procedureContract(), adapter));

    const result = await dispatch({ method: "PATCH", contractPath: "/employees", body: { name: "Alice" } });

    expect(result.status).toBe(200);
    expect(adapter.executePlsqlBlock).toHaveBeenCalledOnce();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("POST direct_table contracts dispatch to the direct write handler.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(directContract(), adapter));

    const result = await dispatch({ method: "POST", contractPath: "/employees", body: { name: "Alice" } });

    expect(result.status).toBe(201);
    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });

  it("PATCH direct_table contracts dispatch to the direct write handler.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(directContract(), adapter));

    const result = await dispatch({
      method: "PATCH",
      contractPath: "/employees",
      idParam: "7",
      body: { name: "Alice" }
    });

    expect(result.status).toBe(200);
    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });

  it("SYS_REFCURSOR read routes dispatch to the cursor read handler.", async () => {
    const cursor = makeCursor([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }]);
    const adapter = makeAdapter(cursor);
    const dispatch = createBridgeDispatcher(makeCtx(cursorContract(), adapter));

    const result = await dispatch({ method: "GET", contractPath: "/employees" });

    expect(result.status).toBe(200);
    expect(adapter.executePlsqlBlock).toHaveBeenCalledOnce();
    expect(adapter.query).not.toHaveBeenCalled();
    expect((result.body as any).data).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("unsupported operations return a clean API error.", async () => {
    const dispatch = createBridgeDispatcher(makeCtx(directContract()));

    const result = await dispatch({ method: "PUT", contractPath: "/employees", body: { name: "Alice" } });

    expect(result.status).toBe(405);
    expect(result.body).toEqual({ error: "Method not allowed for this contract." });
  });

  it("DELETE is intentionally unsupported for the MVP runtime.", async () => {
    const dispatch = createBridgeDispatcher(makeCtx(baseContract({
      operations: [{ operation: "delete", enabled: true }]
    })));

    const result = await dispatch({ method: "DELETE", contractPath: "/employees", idParam: "7" });

    expect(result.status).toBe(405);
    expect(result.body).toEqual({ error: "Method not allowed for this contract." });
  });

  it("unknown routes return 404.", async () => {
    const dispatch = createBridgeDispatcher(makeCtx(baseContract()));

    const result = await dispatch({ method: "GET", contractPath: "/unknown" });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "No contract found for this endpoint." });
  });

  it("disabled operations return method-not-allowed before dispatching.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(procedureContract({
      operations: [{ operation: "create", enabled: false }]
    }), adapter));

    const result = await dispatch({ method: "POST", contractPath: "/employees", body: { name: "Alice" } });

    expect(result.status).toBe(405);
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });
});
