import { describe, expect, it, vi } from "vitest";

import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleConnectorAdapter } from "../../connections/oracle-adapter.js";
import { createPermissiveChecker } from "../permissions.js";
import { createReadHandler } from "../read-handler.js";
import { createWriteHandler } from "../write-handler.js";
import { testOracleBindTypes } from "../oracle-helpers.js";

function tableContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "contract-read",
    resource: "employees",
    version: 3,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees:v3", schemaVersion: "1" },
    source: { database: "legacy", owner: "HR", type: "table", name: "EMPLOYEES" },
    operations: [{ operation: "list", enabled: true }],
    fields: [
      { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID" },
      { apiField: "name", apiType: "string", oracleType: "varchar2", dbColumn: "FULL_NAME" }
    ],
    ...overrides
  };
}

function procedureContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "contract-write",
    resource: "employees",
    version: 4,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees-write:v4", schemaVersion: "1" },
    source: {
      database: "legacy",
      owner: "HR",
      type: "package",
      packageName: "PKG_EMPLOYEE_API",
      procedureName: "CREATE_EMPLOYEE"
    },
    operations: [{ operation: "create", enabled: true }],
    fields: [
      { apiField: "name", apiType: "string", oracleType: "varchar2" },
      { apiField: "password", apiType: "string", oracleType: "varchar2", writeOnly: true },
      { apiField: "id", apiType: "integer", oracleType: "number", readOnly: true }
    ],
    procedureParams: [
      { paramName: "P_NAME", direction: "in", apiField: "name", oracleType: "varchar2", required: true },
      { paramName: "P_PASSWORD", direction: "in", apiField: "password", oracleType: "varchar2" },
      { paramName: "P_ID", direction: "out", apiField: "id", oracleType: "number" }
    ],
    ...overrides
  };
}

function makeAdapter(options: {
  rows?: Record<string, unknown>[];
  outBinds?: Record<string, unknown>;
  queryError?: Error;
} = {}): OracleConnectorAdapter {
  return {
    query: options.queryError
      ? vi.fn().mockRejectedValue(options.queryError)
      : vi.fn().mockResolvedValue({ rows: options.rows ?? [{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }] }),
    execute: vi.fn(),
    executePlsqlBlock: vi.fn().mockResolvedValue({ rows: [], outBinds: options.outBinds ?? { P_ID: 100 } }),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

describe("Bridge runtime audit logging", () => {
  it("1. Successful read writes audit log.", async () => {
    const audit = { log: vi.fn() };
    const handle = createReadHandler({
      adapter: makeAdapter(),
      permissions: createPermissiveChecker(),
      audit
    });

    await handle({
      contract: tableContract(),
      requestId: "req-1",
      identity: { userId: "user-1" },
      tenantId: "tenant-a",
      apiConnectionId: "conn-a",
      publishedContractId: "pub-1"
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.request.succeeded",
        metadata: expect.objectContaining({
          request_id: "req-1",
          user_id: "user-1",
          tenant_id: "tenant-a",
          api_connection_id: "conn-a",
          published_contract_id: "pub-1",
          resource: "employees",
          endpoint: "/api/hr/employees",
          contract_version: 3,
          operation: "list",
          oracle_owner: "HR",
          oracle_object_name: "EMPLOYEES",
          oracle_object_type: "table",
          status: "succeeded",
          duration_ms: expect.any(Number),
          timestamp: expect.any(String)
        })
      })
    );
  });

  it("2. Failed validation writes audit log.", async () => {
    const audit = { log: vi.fn() };
    const handle = createReadHandler({
      adapter: makeAdapter(),
      permissions: createPermissiveChecker(),
      audit
    });

    await handle({
      contract: tableContract(),
      filters: [{ field: "unknown", operator: "eq", value: "x" }],
      requestId: "req-validation"
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.validation.failed",
        metadata: expect.objectContaining({
          request_id: "req-validation",
          code: "VALIDATION_FAILED",
          status: "failed"
        })
      })
    );
  });

  it("3. Oracle error writes audit log.", async () => {
    const audit = { log: vi.fn() };
    const handle = createReadHandler({
      adapter: makeAdapter({ queryError: new Error("ORA-00942: table or view does not exist") }),
      permissions: createPermissiveChecker(),
      audit
    });

    await handle({ contract: tableContract(), requestId: "req-ora" });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.oracle.error",
        metadata: expect.objectContaining({
          request_id: "req-ora",
          oracle_error_code: "ORA-00942",
          code: "CONTRACT_SCHEMA_MISMATCH",
          status: "failed"
        })
      })
    );
  });

  it("4. Procedure execution logs package/procedure name.", async () => {
    const audit = { log: vi.fn() };
    const handle = createWriteHandler({
      adapter: makeAdapter(),
      permissions: createPermissiveChecker(),
      audit,
      oracleBindTypes: testOracleBindTypes
    });

    await handle({
      contract: procedureContract(),
      method: "POST",
      body: { name: "Alice" },
      requestId: "req-proc"
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.plsql.executed",
        metadata: expect.objectContaining({
          request_id: "req-proc",
          oracle_package_name: "PKG_EMPLOYEE_API",
          oracle_procedure_name: "CREATE_EMPLOYEE",
          oracle_object_type: "package",
          status: "succeeded"
        })
      })
    );
  });

  it("5. Sensitive values are not logged.", async () => {
    const audit = { log: vi.fn() };
    const handle = createWriteHandler({
      adapter: makeAdapter(),
      permissions: createPermissiveChecker(),
      audit,
      oracleBindTypes: testOracleBindTypes
    });

    await handle({
      contract: procedureContract(),
      method: "POST",
      body: { name: "Alice", password: "super-secret-password" },
      requestId: "req-secret"
    });

    const auditPayload = JSON.stringify(audit.log.mock.calls);
    expect(auditPayload).not.toContain("super-secret-password");
  });
});

describe("Bridge runtime audit logging — Phase 9f tenant identity", () => {
  it("6. Read audit entries include tenantId and apiConnectionId.", async () => {
    const audit = { log: vi.fn() };
    const handle = createReadHandler({
      adapter: makeAdapter(),
      permissions: createPermissiveChecker(),
      audit
    });

    await handle({
      contract: tableContract(),
      requestId: "req-tenant-read",
      identity: { userId: "user-x" },
      tenantId: "tenant-hr",
      apiConnectionId: "conn-hr",
      publishedContractId: "pub-hr-1"
    });

    const allCalls = audit.log.mock.calls.map(c => c[0].metadata);
    for (const meta of allCalls) {
      expect(meta).toMatchObject({
        tenant_id: "tenant-hr",
        api_connection_id: "conn-hr",
        published_contract_id: "pub-hr-1"
      });
    }
  });

  it("7. Write audit entries include tenantId, apiConnectionId, and userId.", async () => {
    const audit = { log: vi.fn() };
    const handle = createWriteHandler({
      adapter: makeAdapter(),
      permissions: createPermissiveChecker(),
      audit,
      oracleBindTypes: testOracleBindTypes
    });

    await handle({
      contract: procedureContract(),
      method: "POST",
      body: { name: "Bob" },
      requestId: "req-tenant-write",
      identity: { userId: "user-y" },
      tenantId: "tenant-fin",
      apiConnectionId: "conn-fin",
      publishedContractId: "pub-fin-2"
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.plsql.executed",
        metadata: expect.objectContaining({
          user_id: "user-y",
          tenant_id: "tenant-fin",
          api_connection_id: "conn-fin",
          published_contract_id: "pub-fin-2"
        })
      })
    );
  });

  it("8. Read audit without tenant context omits tenant fields.", async () => {
    const audit = { log: vi.fn() };
    const handle = createReadHandler({
      adapter: makeAdapter(),
      permissions: createPermissiveChecker(),
      audit
    });

    await handle({
      contract: tableContract(),
      requestId: "req-no-tenant",
      identity: { userId: "user-z" }
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.request.succeeded",
        metadata: expect.objectContaining({
          user_id: "user-z",
          tenant_id: undefined,
          api_connection_id: undefined,
          published_contract_id: undefined
        })
      })
    );
  });
});
