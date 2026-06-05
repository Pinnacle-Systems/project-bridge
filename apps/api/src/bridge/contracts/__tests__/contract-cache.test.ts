import { describe, expect, it, vi } from "vitest";
import { createContractCache, type ContractCacheStore, type StoredPublishedContractForCache } from "../contract-cache.js";
import { SCHEMA_VERSION, type ResolvedApiContract } from "../index.js";

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
      schemaVersion: SCHEMA_VERSION
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

// ─── Legacy (unscoped) behavior ──────────────────────────────────────────────

describe("ContractCache — legacy unscoped behavior", () => {
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



  it("4. Unsupported schemaVersion is skipped.", async () => {
    const contractData = validResolvedContractData({ runtime: { cacheKey: "employees_v1", schemaVersion: "999" } });
    const store = createMemoryStore([
      { id: "1", endpointPath: "/api/hr/employees", status: "active", contractData }
    ]);

    const logger = { warn: vi.fn(), error: vi.fn() };
    const cache = createContractCache(store, logger);
    await cache.loadActiveContracts();

    expect(cache.getContractByEndpoint("GET", "/api/hr/employees")).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unsupported schema version 999")
    );
  });

  it("5. getContractByEndpoint returns correct contract.", async () => {
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

  it("6. Failed reload keeps previous cache.", async () => {
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

  it("7. reloadContract clears stale endpoint keys by published contract row id.", async () => {
    const data = validResolvedContractData({ endpoint: "/api/hr/old", id: "resolved-1" });
    const store = createMemoryStore([
      { id: "published-1", endpointPath: "/api/hr/old", status: "active", contractData: data }
    ]);

    const logger = { warn: vi.fn(), error: vi.fn() };
    const cache = createContractCache(store, logger);
    await cache.loadActiveContracts();

    expect(cache.getContractByEndpoint("GET", "/api/hr/old")).toBeDefined();

    // Now update the database mock with new endpoint
    const newData = validResolvedContractData({ endpoint: "/api/hr/new", id: "resolved-1" });
    store.publishedContract.findUnique = async () => ({
      id: "published-1", endpointPath: "/api/hr/new", status: "active", contractData: newData
    });

    await cache.reloadContract("published-1");

    // Old endpoint should be gone, new one should be present
    expect(cache.getContractByEndpoint("GET", "/api/hr/old")).toBeUndefined();
    expect(cache.getContractByEndpoint("GET", "/api/hr/new")).toBeDefined();

    // Now set to inactive and verify cleanup
    store.publishedContract.findUnique = async () => ({
      id: "published-1", endpointPath: "/api/hr/new", status: "retired", contractData: newData
    });

    await cache.reloadContract("published-1");
    expect(cache.getContractByEndpoint("GET", "/api/hr/new")).toBeUndefined();
  });

  it("8. methods are correctly mapped and retrieved.", async () => {
    const data = validResolvedContractData({ endpoint: "/api/hr/multi", id: "1" });
    data.operations = [
      { operation: "read", enabled: true },
      { operation: "create", enabled: true }
    ];
    const store = createMemoryStore([
      { id: "1", endpointPath: "/api/hr/multi", status: "active", contractData: data }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    expect(cache.getContractByEndpoint("GET", "/api/hr/multi")).toBeDefined();
    expect(cache.getContractByEndpoint("POST", "/api/hr/multi")).toBeDefined();
    expect(cache.getContractByEndpoint("PUT", "/api/hr/multi")).toBeUndefined();
  });

  it("9. Legacy contract is not accessible via getContractByScopedEndpoint.", async () => {
    const contractData = validResolvedContractData();
    const store = createMemoryStore([
      { id: "1", endpointPath: "/api/hr/employees", status: "active", contractData }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    // Legacy (no tenantId/apiConnectionId) → only visible via legacy lookup
    expect(cache.getContractByEndpoint("GET", "/api/hr/employees")).toBeDefined();
    expect(cache.getContractByScopedEndpoint({
      tenantId: "any-tenant",
      apiConnectionId: "any-conn",
      method: "GET",
      endpointPath: "/api/hr/employees"
    })).toBeUndefined();
  });
});

// ─── Scoped (tenant-aware) behavior ──────────────────────────────────────────

describe("ContractCache — scoped behavior (Phase 9d)", () => {
  it("10. Scoped contract loads under tenantId + apiConnectionId + method + path.", async () => {
    const contractData = validResolvedContractData({
      runtime: { cacheKey: "c1", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    const store = createMemoryStore([
      {
        id: "pub-1",
        endpointPath: "/api/currencies",
        status: "active",
        contractData,
        tenantId: "tenant-a",
        apiConnectionId: "conn-a"
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    const found = cache.getContractByScopedEndpoint({
      tenantId: "tenant-a",
      apiConnectionId: "conn-a",
      method: "GET",
      endpointPath: "/api/currencies"
    });
    expect(found).toBeDefined();
    expect(found?.contract.id).toBe("contract-1");
    expect(found?.publishedContractId).toBe("pub-1");
  });

  it("11. Tenant A and tenant B /currencies resolve to different contracts without collision.", async () => {
    const contractA = validResolvedContractData({
      id: "contract-a",
      runtime: { cacheKey: "a", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    const contractB = validResolvedContractData({
      id: "contract-b",
      runtime: { cacheKey: "b", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-b", apiConnectionId: "conn-b" }
    });
    const store = createMemoryStore([
      {
        id: "pub-a",
        endpointPath: "/api/currencies",
        status: "active",
        contractData: contractA,
        tenantId: "tenant-a",
        apiConnectionId: "conn-a"
      },
      {
        id: "pub-b",
        endpointPath: "/api/currencies",
        status: "active",
        contractData: contractB,
        tenantId: "tenant-b",
        apiConnectionId: "conn-b"
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    const a = cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies"
    });
    const b = cache.getContractByScopedEndpoint({
      tenantId: "tenant-b", apiConnectionId: "conn-b", method: "GET", endpointPath: "/api/currencies"
    });

    expect(a?.contract.id).toBe("contract-a");
    expect(b?.contract.id).toBe("contract-b");
    expect(a?.contract.id).not.toBe(b?.contract.id);
    expect(a?.publishedContractId).toBe("pub-a");
    expect(b?.publishedContractId).toBe("pub-b");
  });

  it("12. Tenant A lookup does not fall back to tenant B when tenant A has no contract.", async () => {
    const contractB = validResolvedContractData({
      id: "contract-b",
      runtime: { cacheKey: "b", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-b", apiConnectionId: "conn-b" }
    });
    const store = createMemoryStore([
      {
        id: "pub-b",
        endpointPath: "/api/currencies",
        status: "active",
        contractData: contractB,
        tenantId: "tenant-b",
        apiConnectionId: "conn-b"
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies"
    })).toBeUndefined();

    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-b", apiConnectionId: "conn-b", method: "GET", endpointPath: "/api/currencies"
    })).toBeDefined();
  });

  it("13. Wrong apiConnectionId returns no contract.", async () => {
    const contractData = validResolvedContractData({
      runtime: { cacheKey: "c1", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    const store = createMemoryStore([
      {
        id: "pub-1",
        endpointPath: "/api/currencies",
        status: "active",
        contractData,
        tenantId: "tenant-a",
        apiConnectionId: "conn-a"
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-WRONG", method: "GET", endpointPath: "/api/currencies"
    })).toBeUndefined();
  });

  it("14. Wrong tenantId returns no contract.", async () => {
    const contractData = validResolvedContractData({
      runtime: { cacheKey: "c1", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    const store = createMemoryStore([
      {
        id: "pub-1",
        endpointPath: "/api/currencies",
        status: "active",
        contractData,
        tenantId: "tenant-a",
        apiConnectionId: "conn-a"
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-WRONG", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies"
    })).toBeUndefined();
  });

  it("15. Scoped contract is not accessible via legacy getContractByEndpoint.", async () => {
    const contractData = validResolvedContractData({
      runtime: { cacheKey: "c1", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    const store = createMemoryStore([
      {
        id: "pub-1",
        endpointPath: "/api/currencies",
        status: "active",
        contractData,
        tenantId: "tenant-a",
        apiConnectionId: "conn-a"
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    // Scoped contract must not bleed into legacy lookup
    expect(cache.getContractByEndpoint("GET", "/api/currencies")).toBeUndefined();
    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies"
    })).toBeDefined();
  });

  it("16. reloadContract evicts and reloads scoped contract under new endpoint.", async () => {
    const data = validResolvedContractData({
      endpoint: "/api/currencies/old",
      id: "resolved-1",
      runtime: { cacheKey: "c1", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    const store = createMemoryStore([
      {
        id: "pub-1",
        endpointPath: "/api/currencies/old",
        status: "active",
        contractData: data,
        tenantId: "tenant-a",
        apiConnectionId: "conn-a"
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies/old"
    })).toBeDefined();

    const newData = validResolvedContractData({
      endpoint: "/api/currencies/new",
      id: "resolved-1",
      runtime: { cacheKey: "c1", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    store.publishedContract.findUnique = async () => ({
      id: "pub-1",
      endpointPath: "/api/currencies/new",
      status: "active",
      contractData: newData,
      tenantId: "tenant-a",
      apiConnectionId: "conn-a"
    });

    await cache.reloadContract("pub-1");

    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies/old"
    })).toBeUndefined();
    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies/new"
    })).toBeDefined();
  });

  it("17. Retiring tenant A contract does not evict tenant B contract for the same endpoint.", async () => {
    const contractA = validResolvedContractData({
      id: "contract-a",
      runtime: { cacheKey: "a", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    const contractB = validResolvedContractData({
      id: "contract-b",
      runtime: { cacheKey: "b", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-b", apiConnectionId: "conn-b" }
    });
    const store = createMemoryStore([
      {
        id: "pub-a",
        endpointPath: "/api/currencies",
        status: "active",
        contractData: contractA,
        tenantId: "tenant-a",
        apiConnectionId: "conn-a"
      },
      {
        id: "pub-b",
        endpointPath: "/api/currencies",
        status: "active",
        contractData: contractB,
        tenantId: "tenant-b",
        apiConnectionId: "conn-b"
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    // Retire tenant A's contract
    store.publishedContract.findUnique = async ({ where }) => {
      if (where.id === "pub-a") {
        return { id: "pub-a", endpointPath: "/api/currencies", status: "retired", contractData: contractA, tenantId: "tenant-a", apiConnectionId: "conn-a" };
      }
      return null;
    };

    await cache.reloadContract("pub-a");

    // Tenant A evicted
    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies"
    })).toBeUndefined();

    // Tenant B untouched
    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-b", apiConnectionId: "conn-b", method: "GET", endpointPath: "/api/currencies"
    })).toBeDefined();
  });

  it("18. tenantId resolved from runtime metadata when not on stored row.", async () => {
    // Contract row has no tenantId/apiConnectionId, but runtime metadata does
    const contractData = validResolvedContractData({
      runtime: { cacheKey: "c1", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-meta", apiConnectionId: "conn-meta" }
    });
    const store = createMemoryStore([
      {
        id: "pub-1",
        endpointPath: "/api/currencies",
        status: "active",
        contractData
        // no tenantId / apiConnectionId on the stored row
      }
    ]);

    const cache = createContractCache(store);
    await cache.loadActiveContracts();

    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-meta", apiConnectionId: "conn-meta", method: "GET", endpointPath: "/api/currencies"
    })).toBeDefined();

    // Not accessible via legacy path
    expect(cache.getContractByEndpoint("GET", "/api/currencies")).toBeUndefined();
  });

  it("19. Failed reload keeps both scoped and legacy maps.", async () => {
    const contractA = validResolvedContractData({
      id: "contract-a",
      runtime: { cacheKey: "a", schemaVersion: SCHEMA_VERSION, tenantId: "tenant-a", apiConnectionId: "conn-a" }
    });
    const legacyData = validResolvedContractData({ id: "legacy-1" });
    const store = createMemoryStore([
      {
        id: "pub-a",
        endpointPath: "/api/currencies",
        status: "active",
        contractData: contractA,
        tenantId: "tenant-a",
        apiConnectionId: "conn-a"
      },
      {
        id: "pub-legacy",
        endpointPath: "/api/hr/employees",
        status: "active",
        contractData: legacyData
      }
    ]);

    const logger = { warn: vi.fn(), error: vi.fn() };
    const cache = createContractCache(store, logger);
    await cache.loadActiveContracts();

    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies"
    })).toBeDefined();
    expect(cache.getContractByEndpoint("GET", "/api/hr/employees")).toBeDefined();

    store.publishedContract.findMany = vi.fn().mockRejectedValue(new Error("DB error"));
    await cache.reloadAllContracts();

    // Both maps preserved
    expect(cache.getContractByScopedEndpoint({
      tenantId: "tenant-a", apiConnectionId: "conn-a", method: "GET", endpointPath: "/api/currencies"
    })).toBeDefined();
    expect(cache.getContractByEndpoint("GET", "/api/hr/employees")).toBeDefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to reload all contracts. Keeping previous cache.",
      expect.any(Error)
    );
  });
});
