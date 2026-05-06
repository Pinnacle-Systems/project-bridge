import { describe, expect, it, vi } from "vitest";
import {
  createCursorReadHandler,
  type CursorLike,
  type CursorReadHandlerContext
} from "../cursor-read-handler.js";
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
 * Example contract:
 *
 *   HRMS_OWNER.PKG_EMPLOYEE_API.GET_EMPLOYEES(
 *     P_DEPT_ID    IN  NUMBER,
 *     P_RESULT     OUT SYS_REFCURSOR
 *   );
 *
 * Cursor returns columns: EMPLOYEE_ID, FULL_NAME, IS_ACTIVE (CHAR Y/N)
 */
function makeContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c-cursor-1",
    resource: "employees",
    version: 1,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "emp_cursor_v1", schemaVersion: "1" },
    source: {
      database: "db1",
      owner: "HRMS_OWNER",
      type: "package",
      packageName: "PKG_EMPLOYEE_API",
      procedureName: "GET_EMPLOYEES"
    },
    fields: [],
    operations: [
      { operation: "list", enabled: true }
    ],
    procedureParams: [
      { paramName: "P_DEPT_ID", direction: "in",  apiField: "departmentId", oracleType: "number" },
      { paramName: "P_RESULT",  direction: "out", oracleType: "sys_refcursor" }
    ],
    sysRefCursor: {
      paramName: "P_RESULT",
      fields: [
        { apiField: "id",       apiType: "integer", oracleType: "number",  dbColumn: "EMPLOYEE_ID" },
        { apiField: "name",     apiType: "string",  oracleType: "char",    dbColumn: "FULL_NAME",
          transformers: [{ kind: "trimRight", oracleType: "char" }] },
        { apiField: "isActive", apiType: "boolean", oracleType: "char",    dbColumn: "IS_ACTIVE",
          transformers: [{ kind: "booleanMapping", oracleType: "char", trueValue: "Y", falseValue: "N" }] }
      ]
    },
    ...overrides
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────────

function makeCursor(rows: Record<string, unknown>[]): CursorLike {
  let offset = 0;
  return {
    getRows: vi.fn(async (numRows: number) => {
      const batch = rows.slice(offset, offset + numRows);
      offset += numRows;
      return batch;
    }),
    close: vi.fn().mockResolvedValue(undefined)
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

function makeAdapter(cursor: CursorLike): OracleConnectorAdapter {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    executePlsqlBlock: vi.fn().mockResolvedValue({ rows: [], outBinds: { P_RESULT: cursor } }),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

function makeCtx(cursor: CursorLike, overrides: Partial<CursorReadHandlerContext> = {}): CursorReadHandlerContext {
  return {
    cache: makeCache(makeContract()),
    adapter: makeAdapter(cursor),
    permissions: createPermissiveChecker(),
    oracleBindTypes: testOracleBindTypes,
    ...overrides
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("CursorReadHandler", () => {
  it("1. OUT SYS_REFCURSOR rows become JSON array.", async () => {
    const cursor = makeCursor([
      { EMPLOYEE_ID: 1, FULL_NAME: "Alice",   IS_ACTIVE: "Y" },
      { EMPLOYEE_ID: 2, FULL_NAME: "Bob",     IS_ACTIVE: "N" }
    ]);
    const handle = createCursorReadHandler(makeCtx(cursor));

    const { status, body } = await handle({ contractPath: "/api/hr/employees" });

    expect(status).toBe(200);
    expect((body as any).data).toEqual([
      { id: 1, name: "Alice", isActive: true },
      { id: 2, name: "Bob",   isActive: false }
    ]);
  });

  it("uses configured driver bind constant for SYS_REFCURSOR OUT params.", async () => {
    const cursor = makeCursor([]);
    const adapter = makeAdapter(cursor);
    const handle = createCursorReadHandler(makeCtx(cursor, { adapter, oracleBindTypes: numericOracleBindTypes }));

    await handle({ contractPath: "/api/hr/employees" });

    const binds = (adapter.executePlsqlBlock as any).mock.calls[0][1];
    expect(binds.P_RESULT).toEqual({ dir: "out", type: numericOracleBindTypes.cursor });
  });

  it("2. CHAR trim applies to cursor row values.", async () => {
    const cursor = makeCursor([
      { EMPLOYEE_ID: 3, FULL_NAME: "Carol     ", IS_ACTIVE: "Y" }
    ]);
    const handle = createCursorReadHandler(makeCtx(cursor));

    const { status, body } = await handle({ contractPath: "/api/hr/employees" });

    expect(status).toBe(200);
    expect((body as any).data[0].name).toBe("Carol");
  });

  it("3. Boolean transformer applies to cursor row values.", async () => {
    const cursor = makeCursor([
      { EMPLOYEE_ID: 4, FULL_NAME: "Dave", IS_ACTIVE: "Y" },
      { EMPLOYEE_ID: 5, FULL_NAME: "Eve",  IS_ACTIVE: "N" }
    ]);
    const handle = createCursorReadHandler(makeCtx(cursor));

    const { body } = await handle({ contractPath: "/api/hr/employees" });

    expect((body as any).data[0].isActive).toBe(true);
    expect((body as any).data[1].isActive).toBe(false);
  });

  it("4. Cursor is closed on success.", async () => {
    const cursor = makeCursor([
      { EMPLOYEE_ID: 1, FULL_NAME: "Test", IS_ACTIVE: "Y" }
    ]);
    const handle = createCursorReadHandler(makeCtx(cursor));

    await handle({ contractPath: "/api/hr/employees" });

    expect(cursor.close).toHaveBeenCalledOnce();
  });

  it("5. Cursor is closed on error.", async () => {
    const cursor = makeCursor([]);
    // Make getRows throw after the first call to simulate a mid-iteration error
    (cursor.getRows as any)
      .mockResolvedValueOnce([{ EMPLOYEE_ID: 1, FULL_NAME: "Fail", IS_ACTIVE: "Y" }])
      .mockRejectedValueOnce(new Error("ORA-01013: user requested cancel of current operation"));

    const handle = createCursorReadHandler(makeCtx(cursor, { fetchBatchSize: 1 }));

    const { status } = await handle({ contractPath: "/api/hr/employees", maxRows: 100 });

    // Cursor must be closed even though iteration errored
    expect(cursor.close).toHaveBeenCalledOnce();
    expect(status).toBe(500);
  });

  it("6. Row limit is enforced.", async () => {
    // Generate 50 rows but set maxRows to 10
    const rows = Array.from({ length: 50 }, (_, i) => ({
      EMPLOYEE_ID: i + 1,
      FULL_NAME: `Employee${i + 1}`,
      IS_ACTIVE: "Y"
    }));
    const cursor = makeCursor(rows);
    const handle = createCursorReadHandler(makeCtx(cursor));

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      maxRows: 10
    });

    expect(status).toBe(200);
    expect((body as any).data).toHaveLength(10);
    expect((body as any).truncated).toBe(true);

    // Cursor must still be closed
    expect(cursor.close).toHaveBeenCalledOnce();
  });
});
