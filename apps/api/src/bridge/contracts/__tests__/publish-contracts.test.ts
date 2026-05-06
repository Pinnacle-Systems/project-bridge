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
          .filter((contract) => !where.resourceName || contract.resourceName === where.resourceName)
          .filter((contract) => !where.endpointPath || contract.endpointPath === where.endpointPath)
          .filter((contract) => !where.status || contract.status === where.status)
          .sort((left, right) => right.version - left.version);
        return matches[0] ?? null;
      },
      async findMany({ where }) {
        return publishedContracts
          .filter((contract) => !where.resourceName || contract.resourceName === where.resourceName)
          .filter((contract) => !where.endpointPath || contract.endpointPath === where.endpointPath)
          .filter((contract) => !where.status || contract.status === where.status);
      },
      async create({ data }) {
        const published: StoredPublishedContract = {
          id: `published-${publishedContracts.length + 1}`,
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
    compile: vi.fn(async ({ version, compiledBy }): Promise<ContractCompileResult> => {
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
        contract: resolvedContract(version ?? 1, { publishedBy: compiledBy }),
        diagnostics: [{ code: "CONTRACT_COMPILED", severity: "info", message: "Compiled." }]
      };
    })
  };
}

describe("contract publish workflow", () => {
  it("publishes a valid draft", async () => {
    const { store, publishedContracts, versions, histories } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    const result = await service.publishDraftContract("draft-1", "admin", "Initial publish");

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

  it("does not publish invalid drafts and stores diagnostics", async () => {
    const { store, publishedContracts, diagnostics } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler({ valid: false }));

    await expect(service.publishDraftContract("draft-1", "admin", "Bad publish")).rejects.toThrow(
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

    const result = await service.publishDraftContract("draft-1", "admin");

    expect(result.publishedContract.version).toBe(1);
    expect(result.versionRecord.version).toBe(1);
  });

  it("creates version 2 on second publish and deprecates previous active", async () => {
    const { store, publishedContracts } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    await service.publishDraftContract("draft-1", "admin", "v1");
    const second = await service.publishDraftContract("draft-1", "admin", "v2");

    expect(second.publishedContract.version).toBe(2);
    expect(second.deprecatedPrevious).toHaveLength(1);
    expect(publishedContracts.map((contract) => contract.status)).toEqual(["deprecated", "active"]);
  });

  it("keeps previous versions traceable", async () => {
    const { store, versions, histories } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    await service.publishDraftContract("draft-1", "admin", "v1");
    await service.publishDraftContract("draft-1", "admin", "v2");

    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    expect(versions[0].publishedContractId).toBe("published-1");
    expect(histories.map((history) => history.notes)).toEqual(["v1", "v2"]);
  });

  it("stores a published contract that passes the meta-schema", async () => {
    const { store } = createMemoryStore();
    const service = createContractPublishService(store, createCompiler());

    const result = await service.publishDraftContract("draft-1", "admin");

    expect(validateResolvedApiContract(result.publishedContract.contractData).success).toBe(true);
  });
});
