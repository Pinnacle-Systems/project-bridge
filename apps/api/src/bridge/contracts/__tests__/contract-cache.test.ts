import { describe, expect, it, vi } from "vitest";
import { createContractCache, type ContractCacheStore, type StoredPublishedContractForCache } from "../contract-cache.js";
import type { ResolvedApiContract } from "../index.js";

function validResolvedContractData(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "contract-1",
    resource: "employees",
    version: 1,
    endpoint: "/api/hr/employees",
    status: "active",
    source: {
      database: "legacy_oracle",
      owner: "HRMS_OWNER",
      type: "table",
      name: "EMPLOYEE_MASTER"
    },
    fields: [
      {
        apiField: "id",
        apiType: "integer",
        dbColumn: "EMPLOYEE_ID",
        oracleType: "number"
      }
    ],
    operations: [
      {
        operation: "read",
        enabled: true
      }
    ],
    publishedAt: new Date("2026-05-06T00:00:00Z"),
    schemaHealth: {
      status: "healthy"
    },
    runtime: {
      cacheKey: "employees_v1",
      schemaVersion: "1.0.0"
    },
    ...overrides
  };
}

function createMemoryStore(initialContracts: StoredPublishedContractForCache[] = []): ContractCacheStore {
  let contracts = [...initialContracts];

  return {
    publishedContract: {
      async findMany({ where }) {
        return contracts.filter(c => c.status === where.status);
      },
      async findUnique({ where }) {
        return contracts.find(c => c.id === where.id) ?? null;
      }
    }
  };
}

describe("ContractCache", () => {
  it("1. Active contracts load into memory.", async () => {
    const contractData = validResolvedContractData();
    const store = createMemoryStore([
      {
        id: "1",
        endpointPath: "/api/hr/employees",
        status: "active",
        contractData
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    const contract = cache.getContractByEndpoint("GET", "/api/hr/employees");
    expect(contract).toBeDefined();
    expect(contract?.id).toBe("contract-1");
  });

  it("2. Draft contracts are not loaded.", async () => {
    const contractData = validResolvedContractData({ status: "draft" as any });
    const store = createMemoryStore([
      {
        id: "1",
        endpointPath: "/api/hr/employees",
        status: "draft", // In DB it might have status draft, though query filters by 'active'
        contractData
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    const contract = cache.getContractByEndpoint("GET", "/api/hr/employees");
    expect(contract).toBeUndefined();
  });

  it("3. Invalid contract_data is rejected.", async () => {
    const invalidData = validResolvedContractData();
    // make it invalid by removing fields
    (invalidData as any).fields = undefined;

    const store = createMemoryStore([
      {
        id: "1",
        endpointPath: "/api/hr/invalid",
        status: "active",
        contractData: invalidData
      }
    ]);

    const logger = { warn: vi.fn(), error: vi.fn() };
    const cache = createContractCache(store, logger);
    await cache.loadActiveContracts();

    const contract = cache.getContractByEndpoint("GET", "/api/hr/invalid");
    expect(contract).toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to validate contract schema for active contract 1:"),
      expect.any(Array)
    );
  });

  it("4. getContractByEndpoint returns correct contract.", async () => {
    const data1 = validResolvedContractData({ endpoint: "/api/hr/e1", id: "c1" });
    const data2 = validResolvedContractData({ endpoint: "/api/hr/e2", id: "c2" });
    const store = createMemoryStore([
      { id: "1", endpointPath: "/api/hr/e1", status: "active", contractData: data1 },
      { id: "2", endpointPath: "/api/hr/e2", status: "active", contractData: data2 }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    expect(cache.getContractByEndpoint("GET", "/api/hr/e1")?.id).toBe("c1");
    expect(cache.getContractByEndpoint("GET", "/api/hr/e2")?.id).toBe("c2");
    expect(cache.getContractByEndpoint("GET", "/api/hr/e3")).toBeUndefined();
  });

  it("5. Failed reload keeps previous cache.", async () => {
    const data1 = validResolvedContractData({ endpoint: "/api/hr/e1", id: "c1" });
    const store = createMemoryStore([
      { id: "1", endpointPath: "/api/hr/e1", status: "active", contractData: data1 }
    ]);

    const logger = { warn: vi.fn(), error: vi.fn() };
    const cache = createContractCache(store, logger);
    await cache.loadActiveContracts();
    
    expect(cache.getContractByEndpoint("GET", "/api/hr/e1")).toBeDefined();

    // Mock store to throw
    store.publishedContract.findMany = vi.fn().mockRejectedValue(new Error("DB Connection Error"));

    await cache.reloadAllContracts();

    // Cache should still have the previous data
    expect(cache.getContractByEndpoint("GET", "/api/hr/e1")).toBeDefined();

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to reload all contracts. Keeping previous cache.",
      expect.any(Error)
    );
  });
});
