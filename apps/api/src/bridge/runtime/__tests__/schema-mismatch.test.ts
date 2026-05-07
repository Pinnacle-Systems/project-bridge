import { describe, expect, it, vi } from "vitest";

import type { ContractCache } from "../../contracts/contract-cache.js";
import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleConnectorAdapter } from "../../connections/oracle-adapter.js";
import { createPermissiveChecker } from "../permissions.js";
import { createReadHandler } from "../read-handler.js";

const SCHEMA_MISMATCH_BODY = {
  success: false,
  error: {
    code: "CONTRACT_SCHEMA_MISMATCH",
    message: "This API contract no longer matches the underlying Oracle schema.",
    status: 500
  }
};

function tableContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "contract-sm",
    resource: "employees",
    version: 2,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees:v2", schemaVersion: "1" },
    source: { database: "legacy", owner: "HR", type: "table", name: "EMPLOYEES" },
    operations: [{ operation: "list", enabled: true }],
    fields: [
      { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID" }
    ],
    ...overrides
  };
}

function makeCache(contract: ResolvedApiContract): ContractCache {
  return {
    getContractByEndpoint: () => contract,
    loadActiveContracts: vi.fn(),
    reloadContract: vi.fn(),
    reloadAllContracts: vi.fn()
  };
}

function makeFailingAdapter(oraMessage: string): OracleConnectorAdapter {
  return {
    query: vi.fn().mockRejectedValue(new Error(oraMessage)),
    execute: vi.fn(),
    executePlsqlBlock: vi.fn(),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

describe("Schema mismatch runtime handling", () => {
  it("1. ORA-00942 returns CONTRACT_SCHEMA_MISMATCH", async () => {
    const audit = { log: vi.fn() };
    const handle = createReadHandler({
      cache: makeCache(tableContract()),
      adapter: makeFailingAdapter("ORA-00942: table or view does not exist"),
      permissions: createPermissiveChecker(),
      audit
    });

    const result = await handle({ contractPath: "/api/hr/employees", requestId: "req-942" });

    expect(result.status).toBe(500);
    expect(result.body).toEqual(SCHEMA_MISMATCH_BODY);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.schema_mismatch",
        metadata: expect.objectContaining({
          oracle_error_code: "ORA-00942",
          contract_version: 2,
          oracle_object_name: "EMPLOYEES",
          request_id: "req-942"
        })
      })
    );
  });

  it("2. ORA-00904 returns CONTRACT_SCHEMA_MISMATCH", async () => {
    const audit = { log: vi.fn() };
    const handle = createReadHandler({
      cache: makeCache(tableContract()),
      adapter: makeFailingAdapter('ORA-00904: "BAD_COL": invalid identifier'),
      permissions: createPermissiveChecker(),
      audit
    });

    const result = await handle({ contractPath: "/api/hr/employees", requestId: "req-904" });

    expect(result.status).toBe(500);
    expect(result.body).toEqual(SCHEMA_MISMATCH_BODY);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.schema_mismatch",
        metadata: expect.objectContaining({
          oracle_error_code: "ORA-00904",
          contract_version: 2,
          oracle_object_name: "EMPLOYEES",
          request_id: "req-904"
        })
      })
    );
  });

  it("3. ORA-04063 returns CONTRACT_SCHEMA_MISMATCH", async () => {
    const audit = { log: vi.fn() };
    const handle = createReadHandler({
      cache: makeCache(tableContract()),
      adapter: makeFailingAdapter('ORA-04063: view "HR.EMPLOYEES_V" has errors'),
      permissions: createPermissiveChecker(),
      audit
    });

    const result = await handle({ contractPath: "/api/hr/employees", requestId: "req-4063" });

    expect(result.status).toBe(500);
    expect(result.body).toEqual(SCHEMA_MISMATCH_BODY);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "runtime.schema_mismatch",
        metadata: expect.objectContaining({
          oracle_error_code: "ORA-04063",
          contract_version: 2,
          oracle_object_name: "EMPLOYEES",
          request_id: "req-4063"
        })
      })
    );
  });

  it("4. Raw Oracle error text is not exposed in response", async () => {
    const handle = createReadHandler({
      cache: makeCache(tableContract()),
      adapter: makeFailingAdapter("ORA-00942: table or view does not exist — HR.EMPLOYEES"),
      permissions: createPermissiveChecker()
    });

    const result = await handle({ contractPath: "/api/hr/employees" });
    const serialised = JSON.stringify(result.body);

    expect(serialised).not.toContain("ORA-");
    expect(serialised).not.toContain("HR.EMPLOYEES");
    expect(serialised).not.toContain("table or view does not exist");
  });
});
