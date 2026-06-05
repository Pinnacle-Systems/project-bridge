import { describe, expect, it, vi } from "vitest";

import type { ContractCompiler } from "../../compiler/index.js";
import type { ContractCompileResult } from "../../compiler/index.js";
import {
  createContractPublishService,
  validateResolvedApiContract,
  type DraftApiContract,
  type PublishContractStore,
  type ResolvedApiContract,
  type StoredContractPublishHistory,
  type StoredContractVersion,
  type StoredDraftContract,
  type StoredPublishedContract
} from "../index.js";

function draftData(overrides: Partial<DraftApiContract> = {}): DraftApiContract {
  return {
    resource: "employees",
    endpoint: "/api/hr/employees",
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
    operations: [{ operation: "read", enabled: true }],
    ...overrides
  };
}

function resolvedContract(version: number, overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  const draft = draftData();
  return {
    ...draft,
    id: `connection-1:employees:${version}`,
    version,
    status: "active",
    publishedAt: new Date("2026-05-06T00:00:00.000Z"),
    publishedBy: "admin",
    pagination: {
      defaultLimit: 50,
      maxLimit: 250,
      strategy: "offsetFetch"
    },
    schemaHealth: {
      status: "healthy",
      checkedAt: new Date("2026-05-06T00:00:00.000Z"),
      oracleObjectStatus: "valid"
    },
    runtime: {
      cacheKey: `/api/hr/employees:v${version}`,
      schemaVersion: "1"
    },
    ...overrides
  };
}

function draftRecord(overrides: Partial<StoredDraftContract> = {}): StoredDraftContract {
  const now = new Date("2026-05-06T00:00:00.000Z");
  return {
    id: "draft-1",
    apiConnectionId: "connection-1",
    resourceName: "employees",
    endpointPath: "/api/hr/employees",
    draftData: draftData(),
    status: "draft",
    createdBy: "admin",
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createMemoryStore(draft = draftRecord()) {
  const publishedContracts: StoredPublishedContract[] = [];
  const versions: StoredContractVersion[] = [];
  const histories: StoredContractPublishHistory[] = [];
  const diagnostics: unknown[] = [];

  const store: PublishContractStore = {
    apiContractDraft: {
      async findUnique() {
        return draft;
      }
    },
    publishedContract: {
      async findFirst({ where }) {
        const matches = publishedContracts
          .filter((c) => !where.resourceName || c.resourceName === where.resourceName)
          .filter((c) => !where.endpointPath || c.endpointPath === where.endpointPath)
          .filter((c) => !where.status || c.status === where.status)
          .filter((c) => !where.tenantId || c.tenantId === where.tenantId)
          .filter((c) => !where.apiConnectionId || c.apiConnectionId === where.apiConnectionId)
          .sort((a, b) => b.version - a.version);
        return matches[0] ?? null;
      },
      async findMany({ where }) {
        return publishedContracts
          .filter((c) => !where.resourceName || c.resourceName === where.resourceName)
          .filter((c) => !where.endpointPath || c.endpointPath === where.endpointPath)
          .filter((c) => !where.status || c.status === where.status)
          .filter((c) => !where.tenantId || c.tenantId === where.tenantId)
          .filter((c) => !where.apiConnectionId || c.apiConnectionId === where.apiConnectionId);
      },
      async create({ data }) {
        const published: StoredPublishedContract = {
          id: `published-${publishedContracts.length + 1}`,
          tenantId: data.tenantId ?? null,
          apiConnectionId: data.apiConnectionId ?? null,
          resourceName: data.resourceName,
          version: data.version,
          endpointPath: data.endpointPath,
          contractData: data.contractData,
          status: data.status
        };
        publishedContracts.push(published);
        return published;
      },
      async update({ where, data }) {
        const contract = publishedContracts.find((candidate) => candidate.id === where.id);
        if (!contract) {
          throw new Error("Published contract not found.");
        }
        Object.assign(contract, data);
        return contract;
      }
    },
    apiContractVersion: {
      async create({ data }) {
        const version: StoredContractVersion = {
          id: `version-${versions.length + 1}`,
          apiContractDraftId: data.apiContractDraftId,
          publishedContractId: data.publishedContractId,
          version: data.version,
          versionData: data.versionData,
          createdBy: data.createdBy,
          createdAt: new Date("2026-05-06T00:00:00.000Z")
        };
        versions.push(version);
        return version;
      }
    },
    contractPublishHistory: {
      async create({ data }) {
        const history: StoredContractPublishHistory = {
          id: `history-${histories.length + 1}`,
          publishedContractId: data.publishedContractId,
          action: data.action,
          actor: data.actor,
          notes: data.notes ?? null,
          createdAt: new Date("2026-05-06T00:00:00.000Z")
        };
        histories.push(history);
        return history;
      }
    },
    compilerDiagnostic: {
      async createMany({ data }) {
        diagnostics.push(...data);
        return { count: data.length };
      }
    }
  };

  return { store, publishedContracts, versions, histories, diagnostics };
}

function createCompiler(options: { valid?: boolean } = {}): ContractCompiler {
  const valid = options.valid ?? true;
  return {
    compile: vi.fn(async ({ version, compiledBy, tenantId, apiConnectionId }): Promise<ContractCompileResult> => {
      if (!valid) {
        return {
          diagnostics: [
            {
              code: "SOURCE_OBJECT_NOT_FOUND",
              severity: "error",
              message: "Source object missing.",
              path: "source.name"
            }
          ]
        };
      }
      return {
        contract: resolvedContract(version ?? 1, {
          publishedBy: compiledBy,
          runtime: {
            tenantId,
            apiConnectionId,
            cacheKey: `/api/hr/employees:v${version ?? 1}`,
            schemaVersion: "1"
          }
        }),
        diagnostics: [{ code: "CONTRACT_COMPILED", severity: "info", message: "Compiled." }]
      };
    })
  };
}

const TENANT_A = "tenant-a-uuid";
const TENANT_B = "tenant-b-uuid";

describe("contract publish workflow", () => {
  it("publishes a valid draft", async () => {
    const { store, publishedContracts, versions, histories } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    const result = await service.publishDraftContract("draft-1", "admin", TENANT_A, "Initial publish");

    expect(result.publishedContract).toMatchObject({
      id: "published-1",
      resourceName: "employees",
      endpointPath: "/api/hr/employees",
      status: "active"
    });
    expect(publishedContracts).toHaveLength(1);
    expect(versions).toHaveLength(1);
    expect(histories).toHaveLength(1);
    expect(result.historyRecord.notes).toBe("Initial publish");
  });

  it("stores tenantId and apiConnectionId on the published contract row", async () => {
    const { store, publishedContracts } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    await service.publishDraftContract("draft-1", "admin", TENANT_A);

    expect(publishedContracts[0].tenantId).toBe(TENANT_A);
    expect(publishedContracts[0].apiConnectionId).toBe("connection-1");
  });

  it("resolved contract runtime contains tenantId and apiConnectionId", async () => {
    const { store } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    const result = await service.publishDraftContract("draft-1", "admin", TENANT_A);
    const contractData = result.publishedContract.contractData as ResolvedApiContract;

    expect(contractData.runtime.tenantId).toBe(TENANT_A);
    expect(contractData.runtime.apiConnectionId).toBe("connection-1");
  });

  it("does not publish invalid drafts and stores diagnostics", async () => {
    const { store, publishedContracts, diagnostics } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler({ valid: false }));

    await expect(service.publishDraftContract("draft-1", "admin", TENANT_A, "Bad publish")).rejects.toThrow(
      "failed compilation"
    );

    expect(publishedContracts).toHaveLength(0);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SOURCE_OBJECT_NOT_FOUND",
          severity: "error"
        })
      ])
    );
  });

  it("creates version 1 on first publish", async () => {
    const { store } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    const result = await service.publishDraftContract("draft-1", "admin", TENANT_A);

    expect(result.publishedContract.version).toBe(1);
    expect(result.versionRecord.version).toBe(1);
  });

  it("creates version 2 on second publish and deprecates previous active", async () => {
    const { store, publishedContracts } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    await service.publishDraftContract("draft-1", "admin", TENANT_A, "v1");
    const second = await service.publishDraftContract("draft-1", "admin", TENANT_A, "v2");

    expect(second.publishedContract.version).toBe(2);
    expect(second.deprecatedPrevious).toHaveLength(1);
    expect(publishedContracts.map((contract) => contract.status)).toEqual(["deprecated", "active"]);
  });

  it("keeps previous versions traceable", async () => {
    const { store, versions, histories } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    await service.publishDraftContract("draft-1", "admin", TENANT_A, "v1");
    await service.publishDraftContract("draft-1", "admin", TENANT_A, "v2");

    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    expect(versions[0].publishedContractId).toBe("published-1");
    expect(histories.map((history) => history.notes)).toEqual(["v1", "v2"]);
  });

  it("stores a published contract that passes the meta-schema", async () => {
    const { store } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    const result = await service.publishDraftContract("draft-1", "admin", TENANT_A);

    expect(validateResolvedApiContract(result.publishedContract.contractData).success).toBe(true);
  });

  // ── Phase 9c — Cross-tenant isolation ───────────────────────────────────────

  it("tenant A and tenant B can both publish the same endpoint path without collision", async () => {
    const { store, publishedContracts } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    // Both tenants publish the same endpoint /api/hr/employees using the same connection
    await service.publishDraftContract("draft-1", "admin", TENANT_A);
    await service.publishDraftContract("draft-1", "admin", TENANT_B);

    expect(publishedContracts).toHaveLength(2);
    expect(publishedContracts[0].tenantId).toBe(TENANT_A);
    expect(publishedContracts[1].tenantId).toBe(TENANT_B);
    // Both at version 1 — independent versioning per tenant
    expect(publishedContracts[0].version).toBe(1);
    expect(publishedContracts[1].version).toBe(1);
  });

  it("publishing a new version for tenant A does not deprecate tenant B's active contract", async () => {
    const { store, publishedContracts } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    // Tenant A publishes v1
    await service.publishDraftContract("draft-1", "admin", TENANT_A, "a-v1");
    // Tenant B publishes v1
    await service.publishDraftContract("draft-1", "admin", TENANT_B, "b-v1");
    // Tenant A publishes v2 — should deprecate only tenant A's v1
    const result = await service.publishDraftContract("draft-1", "admin", TENANT_A, "a-v2");

    expect(result.deprecatedPrevious).toHaveLength(1);
    expect(result.deprecatedPrevious[0].tenantId).toBe(TENANT_A);

    const tenantBContract = publishedContracts.find((c) => c.tenantId === TENANT_B);
    expect(tenantBContract?.status).toBe("active");

    const tenantAV1 = publishedContracts.find((c) => c.tenantId === TENANT_A && c.version === 1);
    expect(tenantAV1?.status).toBe("deprecated");
  });

  it("version sequences are independent per tenant", async () => {
    const { store, publishedContracts } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    await service.publishDraftContract("draft-1", "admin", TENANT_A, "a-v1");
    await service.publishDraftContract("draft-1", "admin", TENANT_A, "a-v2");
    await service.publishDraftContract("draft-1", "admin", TENANT_B, "b-v1");

    const tenantAVersions = publishedContracts
      .filter((c) => c.tenantId === TENANT_A)
      .map((c) => c.version)
      .sort();
    const tenantBVersions = publishedContracts
      .filter((c) => c.tenantId === TENANT_B)
      .map((c) => c.version);

    expect(tenantAVersions).toEqual([1, 2]);
    expect(tenantBVersions).toEqual([1]);
  });
});
