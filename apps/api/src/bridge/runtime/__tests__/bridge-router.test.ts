import { describe, expect, it, vi } from "vitest";
import { createBridgeDispatcher, type BridgeRouterContext } from "../bridge-router.js";
import type { ContractCache } from "../../contracts/contract-cache.js";
import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleConnectorAdapter } from "../../connections/oracle-adapter.js";
import { createPermissiveChecker } from "../permissions.js";
import { testOracleBindTypes } from "../oracle-helpers.js";
import type { CursorLike } from "../cursor-read-handler.js";

const NOW = new Date("2026-05-23T00:00:00.000Z");

// ── Default tenant context used across all dispatcher tests ──────────────────
const TENANT_A = "tenant-a";
const CONN_A = "conn-a";
const TENANT_B = "tenant-b";
const CONN_B = "conn-b";

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

/** Cache that returns contract for tenant-a/conn-a at /employees only. */
function makeCache(contract?: ResolvedApiContract): ContractCache {
  return {
    getContractByEndpoint: vi.fn(() => undefined),
    getContractByScopedEndpoint: vi.fn(({ tenantId, apiConnectionId, endpointPath }) =>
      tenantId === TENANT_A && apiConnectionId === CONN_A && endpointPath === "/employees" && contract
        ? { contract, publishedContractId: "pub-1" }
        : undefined
    ),
    loadActiveContracts: vi.fn(),
    reloadContract: vi.fn(),
    reloadAllContracts: vi.fn()
  };
}

/** Cache with two tenant-scoped contracts at the same path — proves no collision. */
function makeScopedCache(
  contractA: ResolvedApiContract,
  contractB: ResolvedApiContract,
  basePath = "/employees"
): ContractCache {
  return {
    getContractByEndpoint: vi.fn(() => undefined),
    getContractByScopedEndpoint: vi.fn(({ tenantId, apiConnectionId, endpointPath }) => {
      if (endpointPath !== basePath) return undefined;
      if (tenantId === TENANT_A && apiConnectionId === CONN_A) return { contract: contractA, publishedContractId: "pub-a" };
      if (tenantId === TENANT_B && apiConnectionId === CONN_B) return { contract: contractB, publishedContractId: "pub-b" };
      return undefined;
    }),
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

// ── Scoped dispatch (tenant context required) ────────────────────────────────

describe("Bridge runtime router dispatch", () => {
  it("GET list routes dispatch to the read handler.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(baseContract(), adapter));

    const result = await dispatch({
      method: "GET",
      contractPath: "/employees",
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(200);
    expect(adapter.query).toHaveBeenCalledOnce();
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });

  it("POST package/procedure contracts dispatch to the write handler.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(procedureContract(), adapter));

    const result = await dispatch({
      method: "POST",
      contractPath: "/employees",
      body: { name: "Alice" },
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(201);
    expect(adapter.executePlsqlBlock).toHaveBeenCalledOnce();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("PATCH package/procedure contracts dispatch to the write handler as update.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(procedureContract(), adapter));

    const result = await dispatch({
      method: "PATCH",
      contractPath: "/employees",
      body: { name: "Alice" },
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(200);
    expect(adapter.executePlsqlBlock).toHaveBeenCalledOnce();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("POST direct_table contracts dispatch to the direct write handler.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(directContract(), adapter));

    const result = await dispatch({
      method: "POST",
      contractPath: "/employees",
      body: { name: "Alice" },
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

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
      body: { name: "Alice" },
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(200);
    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });

  it("SYS_REFCURSOR read routes dispatch to the cursor read handler.", async () => {
    const cursor = makeCursor([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }]);
    const adapter = makeAdapter(cursor);
    const dispatch = createBridgeDispatcher(makeCtx(cursorContract(), adapter));

    const result = await dispatch({
      method: "GET",
      contractPath: "/employees",
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(200);
    expect(adapter.executePlsqlBlock).toHaveBeenCalledOnce();
    expect(adapter.query).not.toHaveBeenCalled();
    expect((result.body as any).data).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("unsupported operations return a clean API error.", async () => {
    const dispatch = createBridgeDispatcher(makeCtx(directContract()));

    const result = await dispatch({
      method: "PUT",
      contractPath: "/employees",
      body: { name: "Alice" },
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(405);
    expect(result.body).toEqual({ error: "Method not allowed for this contract." });
  });

  it("DELETE is intentionally unsupported for the MVP runtime.", async () => {
    const dispatch = createBridgeDispatcher(makeCtx(baseContract({
      operations: [{ operation: "delete", enabled: true }]
    })));

    const result = await dispatch({
      method: "DELETE",
      contractPath: "/employees",
      idParam: "7",
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(405);
    expect(result.body).toEqual({ error: "Method not allowed for this contract." });
  });

  it("booleanMapping filter is transformed to Oracle value before SQL bind.", async () => {
    const contract = baseContract({
      fields: [
        { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID", readOnly: true },
        {
          apiField: "isActive",
          apiType: "boolean",
          oracleType: "varchar2",
          dbColumn: "ACTIVE",
          transformers: [{ kind: "booleanMapping", oracleType: "varchar2", trueValue: "Y", falseValue: "N" }]
        }
      ]
    });
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(contract, adapter));

    await dispatch({
      method: "GET",
      contractPath: "/employees",
      filters: [{ field: "isActive", operator: "eq", value: "true" }],
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(adapter.query).toHaveBeenCalledWith(
      expect.stringContaining('"ACTIVE" = :p1'),
      expect.objectContaining({ p1: "Y" }),
      expect.anything()
    );
  });

  it("unknown routes return 404.", async () => {
    const dispatch = createBridgeDispatcher(makeCtx(baseContract()));

    const result = await dispatch({
      method: "GET",
      contractPath: "/unknown",
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "No contract found for this endpoint." });
  });

  it("disabled operations return method-not-allowed before dispatching.", async () => {
    const adapter = makeAdapter();
    const dispatch = createBridgeDispatcher(makeCtx(procedureContract({
      operations: [{ operation: "create", enabled: false }]
    }), adapter));

    const result = await dispatch({
      method: "POST",
      contractPath: "/employees",
      body: { name: "Alice" },
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(405);
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });
});

// ── Phase 9e: scoped cache is the only lookup path ───────────────────────────

describe("Bridge dispatcher — Phase 9e scoped cache (tenant-required)", () => {
  it("dispatch always calls getContractByScopedEndpoint.", async () => {
    const adapter = makeAdapter();
    const contractA = baseContract({ id: "c-a" });
    const cache = makeCache(contractA);
    const ctx: BridgeRouterContext = { cache, adapter, permissions: createPermissiveChecker(), oracleBindTypes: testOracleBindTypes };
    const dispatch = createBridgeDispatcher(ctx);

    await dispatch({
      method: "GET",
      contractPath: "/employees",
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(cache.getContractByScopedEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A, apiConnectionId: CONN_A, method: "GET" })
    );
    expect(cache.getContractByEndpoint).not.toHaveBeenCalled();
  });

  it("dispatch never falls back to getContractByEndpoint when no scoped contract is found.", async () => {
    const adapter = makeAdapter();
    const cache = makeCache(undefined); // no contract registered
    const ctx: BridgeRouterContext = { cache, adapter, permissions: createPermissiveChecker(), oracleBindTypes: testOracleBindTypes };
    const dispatch = createBridgeDispatcher(ctx);

    const result = await dispatch({
      method: "GET",
      contractPath: "/employees",
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(404);
    expect(cache.getContractByEndpoint).not.toHaveBeenCalled();
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("wrong tenantId returns 404 without reaching the read handler.", async () => {
    const adapter = makeAdapter();
    const contractA = baseContract({ id: "c-a" });
    const contractB = baseContract({ id: "c-b" });
    const cache = makeScopedCache(contractA, contractB);
    const ctx: BridgeRouterContext = { cache, adapter, permissions: createPermissiveChecker(), oracleBindTypes: testOracleBindTypes };
    const dispatch = createBridgeDispatcher(ctx);

    const result = await dispatch({
      method: "GET",
      contractPath: "/employees",
      tenantId: "tenant-wrong",
      apiConnectionId: CONN_A
    });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "No contract found for this endpoint." });
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("wrong apiConnectionId returns 404 without reaching the read handler.", async () => {
    const adapter = makeAdapter();
    const contractA = baseContract({ id: "c-a" });
    const contractB = baseContract({ id: "c-b" });
    const cache = makeScopedCache(contractA, contractB);
    const ctx: BridgeRouterContext = { cache, adapter, permissions: createPermissiveChecker(), oracleBindTypes: testOracleBindTypes };
    const dispatch = createBridgeDispatcher(ctx);

    const result = await dispatch({
      method: "GET",
      contractPath: "/employees",
      tenantId: TENANT_A,
      apiConnectionId: "conn-wrong"
    });

    expect(result.status).toBe(404);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("same endpoint with different tenants dispatches to different contracts.", async () => {
    const adapter = makeAdapter();
    const contractA = baseContract({ id: "c-a" });
    const contractB = baseContract({ id: "c-b" });
    const cache = makeScopedCache(contractA, contractB);
    const ctx: BridgeRouterContext = { cache, adapter, permissions: createPermissiveChecker(), oracleBindTypes: testOracleBindTypes };
    const dispatch = createBridgeDispatcher(ctx);

    const resultA = await dispatch({
      method: "GET",
      contractPath: "/employees",
      tenantId: TENANT_A,
      apiConnectionId: CONN_A
    });
    const resultB = await dispatch({
      method: "GET",
      contractPath: "/employees",
      tenantId: TENANT_B,
      apiConnectionId: CONN_B
    });

    expect(resultA.status).toBe(200);
    expect(resultB.status).toBe(200);

    expect(cache.getContractByScopedEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A, apiConnectionId: CONN_A })
    );
    expect(cache.getContractByScopedEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_B, apiConnectionId: CONN_B })
    );
  });
});
