import { describe, expect, it, vi } from "vitest";
import { createReadHandler, type ReadHandlerContext } from "../read-handler.js";
import type { ContractCache } from "../../contracts/contract-cache.js";
import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleConnectorAdapter } from "../../connections/oracle-adapter.js";
import { createPermissiveChecker } from "../permissions.js";

function makeContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c1",
    resource: "employees",
    version: 1,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees_v1", schemaVersion: "1" },
    source: { database: "db1", owner: "HR", type: "table", name: "EMPLOYEES" },
    fields: [
      { apiField: "id",       apiType: "integer", oracleType: "number",   dbColumn: "EMPLOYEE_ID" },
      { apiField: "name",     apiType: "string",  oracleType: "varchar2", dbColumn: "FULL_NAME" },
      { apiField: "password", apiType: "string",  oracleType: "varchar2", dbColumn: "PASSWORD_HASH", writeOnly: true }
    ],
    operations: [
      { operation: "list", enabled: true },
      { operation: "read", enabled: true }
    ],
    ...overrides
  };
}

function makeCache(contract: ResolvedApiContract | undefined): ContractCache {
  return {
    getContractByEndpoint: (_method, path) =>
      path === "/api/hr/employees" ? contract : undefined,
    loadActiveContracts: vi.fn(),
    reloadContract: vi.fn(),
    reloadAllContracts: vi.fn()
  };
}

function makeAdapter(rows: Record<string, unknown>[]): OracleConnectorAdapter {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
    execute: vi.fn(),
    executePlsqlBlock: vi.fn(),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

function makeCtx(overrides: Partial<ReadHandlerContext> = {}): ReadHandlerContext {
  return {
    cache: makeCache(makeContract()),
    adapter: makeAdapter([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }]),
    permissions: createPermissiveChecker(),
    ...overrides
  };
}

describe("ReadHandler", () => {
  it("1. GET list returns mapped fields.", async () => {
    const adapter = makeAdapter([
      { EMPLOYEE_ID: 1, FULL_NAME: "Alice" },
      { EMPLOYEE_ID: 2, FULL_NAME: "Bob" }
    ]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contractPath: "/api/hr/employees" });

    expect(status).toBe(200);
    expect(body).toEqual({
      data: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" }
      ]
    });
  });

  it("2. GET by id works.", async () => {
    const adapter = makeAdapter([{ EMPLOYEE_ID: 42, FULL_NAME: "Carol" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contractPath: "/api/hr/employees", idParam: "42" });

    expect(status).toBe(200);
    expect(body).toEqual({ data: { id: 42, name: "Carol" } });
  });

  it("3. Unknown filter returns 400.", async () => {
    const handle = createReadHandler(makeCtx());

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      filters: [{ field: "nonexistent", operator: "eq", value: "x" }]
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("Unknown filter field: nonexistent");
  });

  it("4. Unmapped (writeOnly) DB column is not returned.", async () => {
    // Mock returns the writeOnly column anyway — handler must strip it.
    const adapter = makeAdapter([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice", PASSWORD_HASH: "secret" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contractPath: "/api/hr/employees" });

    expect(status).toBe(200);
    const row = (body as any).data[0];
    expect(row).not.toHaveProperty("password");
    expect(row).not.toHaveProperty("PASSWORD_HASH");
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("name");
  });

  it("5. Unauthorized field is hidden when allowedFields is set.", async () => {
    const contract = makeContract({
      operations: [
        { operation: "list", enabled: true, allowedFields: ["id"] },
        { operation: "read", enabled: true }
      ]
    });
    const adapter = makeAdapter([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }]);
    const handle = createReadHandler(makeCtx({ cache: makeCache(contract), adapter }));

    const { status, body } = await handle({ contractPath: "/api/hr/employees" });

    expect(status).toBe(200);
    const row = (body as any).data[0];
    expect(row).toEqual({ id: 1 });
    expect(row).not.toHaveProperty("name");
  });

  it("6. Oracle adapter receives bind variables.", async () => {
    const adapter = makeAdapter([{ EMPLOYEE_ID: 7, FULL_NAME: "Dave" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    await handle({ contractPath: "/api/hr/employees", idParam: "7" });

    expect(adapter.query).toHaveBeenCalledWith(
      expect.stringContaining(":p1"),
      expect.objectContaining({ p1: "7" }),
      expect.objectContaining({ outFormat: "object" })
    );
  });
});
