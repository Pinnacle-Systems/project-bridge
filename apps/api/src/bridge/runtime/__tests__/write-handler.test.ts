import { describe, expect, it, vi } from "vitest";
import { createWriteHandler, type WriteHandlerContext } from "../write-handler.js";
import type { ContractCache } from "../../contracts/contract-cache.js";
import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleConnectorAdapter } from "../../connections/oracle-adapter.js";
import { createPermissiveChecker } from "../permissions.js";

/**
 * Example procedure-backed contract:
 *
 *   HRMS_OWNER.PKG_EMPLOYEE_API.CREATE_EMPLOYEE(
 *     P_EMPLOYEE_NAME  IN  VARCHAR2,
 *     P_DEPARTMENT_ID  IN  NUMBER,
 *     P_EMPLOYEE_ID    OUT NUMBER
 *   );
 */
function makeContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c-write-1",
    resource: "employees",
    version: 1,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "emp_write_v1", schemaVersion: "1" },
    source: {
      database: "db1",
      owner: "HRMS_OWNER",
      type: "package",
      packageName: "PKG_EMPLOYEE_API",
      procedureName: "CREATE_EMPLOYEE"
    },
    fields: [
      { apiField: "employeeName",  apiType: "string",  oracleType: "varchar2" },
      { apiField: "departmentId",  apiType: "integer",  oracleType: "number" },
      { apiField: "employeeId",    apiType: "integer",  oracleType: "number", readOnly: true }
    ],
    operations: [
      { operation: "create", enabled: true },
      { operation: "update", enabled: true }
    ],
    procedureParams: [
      { paramName: "P_EMPLOYEE_NAME", direction: "in",  apiField: "employeeName",  oracleType: "varchar2", required: true },
      { paramName: "P_DEPARTMENT_ID", direction: "in",  apiField: "departmentId",  oracleType: "number",   required: true },
      { paramName: "P_EMPLOYEE_ID",   direction: "out", apiField: "employeeId",    oracleType: "number" }
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

function makeAdapter(outBinds: Record<string, unknown> = {}): OracleConnectorAdapter {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    executePlsqlBlock: vi.fn().mockResolvedValue({ rows: [], outBinds }),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

function makeCtx(overrides: Partial<WriteHandlerContext> = {}): WriteHandlerContext {
  return {
    cache: makeCache(makeContract()),
    adapter: makeAdapter({ P_EMPLOYEE_ID: 1001 }),
    permissions: createPermissiveChecker(),
    ...overrides
  };
}

describe("WriteHandler", () => {
  it("1. IN params are bound.", async () => {
    const adapter = makeAdapter({ P_EMPLOYEE_ID: 42 });
    const handle = createWriteHandler(makeCtx({ adapter }));

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "Alice", departmentId: 10 }
    });

    expect(status).toBe(201);

    // Verify the PL/SQL block shape
    expect(adapter.executePlsqlBlock).toHaveBeenCalledWith(
      expect.stringContaining("HRMS_OWNER.PKG_EMPLOYEE_API.CREATE_EMPLOYEE"),
      expect.objectContaining({
        P_EMPLOYEE_NAME: "Alice",
        P_DEPARTMENT_ID: 10
      }),
      expect.objectContaining({ autoCommit: true })
    );

    // Verify the bind placeholders use named params
    const plsql = (adapter.executePlsqlBlock as any).mock.calls[0][0];
    expect(plsql).toContain("P_EMPLOYEE_NAME => :P_EMPLOYEE_NAME");
    expect(plsql).toContain("P_DEPARTMENT_ID => :P_DEPARTMENT_ID");
    expect(plsql).toContain("P_EMPLOYEE_ID => :P_EMPLOYEE_ID");
  });

  it("2. OUT params are returned.", async () => {
    const adapter = makeAdapter({ P_EMPLOYEE_ID: 1001 });
    const handle = createWriteHandler(makeCtx({ adapter }));

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "Bob", departmentId: 20 }
    });

    expect(status).toBe(201);
    expect((body as any).data).toEqual({ employeeId: 1001 });
  });

  it("3. Unknown field rejected.", async () => {
    const handle = createWriteHandler(makeCtx());

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "Eve", departmentId: 10, hackerField: "drop table" }
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("Unknown field: hackerField");
  });

  it("4. Read-only field rejected.", async () => {
    const handle = createWriteHandler(makeCtx());

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "Eve", departmentId: 10, employeeId: 9999 }
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("read-only");
  });

  it("5. ORA error translated.", async () => {
    const adapter = makeAdapter();
    (adapter.executePlsqlBlock as any).mockRejectedValue(
      new Error("ORA-00001: unique constraint (HRMS_OWNER.EMP_NAME_UK) violated")
    );
    const handle = createWriteHandler(makeCtx({ adapter }));

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "Duplicate", departmentId: 10 }
    });

    expect(status).toBe(409);
    expect((body as any).code).toBe("UNIQUE_CONSTRAINT");
    expect((body as any).error).not.toContain("ORA-00001");
  });

  it("6. Audit log written.", async () => {
    const audit = { log: vi.fn() };
    const handle = createWriteHandler(makeCtx({ audit }));

    await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "Carol", departmentId: 30 }
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.request.received",
        metadata: expect.objectContaining({
          contractId: "c-write-1",
          operation: "create"
        })
      })
    );
  });

  it("returns 200 for PUT/update operations.", async () => {
    const adapter = makeAdapter({ P_EMPLOYEE_ID: 42 });
    const handle = createWriteHandler(makeCtx({ adapter }));

    const { status } = await handle({
      contractPath: "/api/hr/employees",
      method: "PUT",
      body: { employeeName: "Updated", departmentId: 10 }
    });

    expect(status).toBe(200);
  });

  it("rejects table/view source for writes.", async () => {
    const contract = makeContract({
      source: { database: "db1", owner: "HR", type: "table", name: "EMPLOYEES" }
    });
    const handle = createWriteHandler(makeCtx({ cache: makeCache(contract) }));

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "X", departmentId: 1 }
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("package or procedure source");
  });

  it("rejects missing required fields.", async () => {
    const handle = createWriteHandler(makeCtx());

    const { status, body } = await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "NoDepId" }
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("Required field");
    expect((body as any).error).toContain("departmentId");
  });

  it("audit log written on ORA failure.", async () => {
    const audit = { log: vi.fn() };
    const adapter = makeAdapter();
    (adapter.executePlsqlBlock as any).mockRejectedValue(
      new Error("ORA-06550: line 1, column 7: PLS-00201: identifier must be declared")
    );
    const handle = createWriteHandler(makeCtx({ adapter, audit }));

    await handle({
      contractPath: "/api/hr/employees",
      method: "POST",
      body: { employeeName: "Fail", departmentId: 10 }
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.request.failed",
        metadata: expect.objectContaining({
          contractId: "c-write-1",
          operation: "create"
        })
      })
    );
  });
});
