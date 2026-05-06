import { describe, expect, it } from "vitest";

import {
  createDraftContractService,
  type BridgeContractStore,
  type DraftApiContract,
  type StoredDraftContract,
  type StoredPublishedContract
} from "../index.js";

function draftContract(overrides: Partial<DraftApiContract> = {}): DraftApiContract {
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
    operations: [
      {
        operation: "read",
        enabled: true
      }
    ],
    ...overrides
  };
}

function createMemoryStore(publishedContracts: StoredPublishedContract[] = []) {
  const drafts: StoredDraftContract[] = [];

  const store: BridgeContractStore = {
    apiContractDraft: {
      async create({ data }) {
        const now = new Date("2026-05-06T00:00:00.000Z");
        const draft: StoredDraftContract = {
          id: `draft-${drafts.length + 1}`,
          apiConnectionId: data.apiConnectionId,
          resourceName: data.resourceName,
          endpointPath: data.endpointPath,
          draftData: data.draftData,
          status: data.status,
          createdBy: data.createdBy ?? null,
          updatedBy: null,
          createdAt: now,
          updatedAt: now
        };
        drafts.push(draft);
        return draft;
      },

      async update({ where, data }) {
        const draft = drafts.find((candidate) => candidate.id === where.id);
        if (!draft) {
          throw new Error("Draft not found.");
        }
        Object.assign(draft, data, { updatedAt: new Date("2026-05-06T01:00:00.000Z") });
        return draft;
      },

      async findUnique({ where }) {
        return drafts.find((draft) => draft.id === where.id) ?? null;
      },

      async findMany(args) {
        return drafts
          .filter((draft) => !args?.where?.apiConnectionId || draft.apiConnectionId === args.where.apiConnectionId)
          .filter((draft) => !args?.where?.status || draft.status === args.where.status)
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
      }
    },

    publishedContract: {
      async findFirst({ where }) {
        return (
          publishedContracts.find(
            (contract) =>
              (!where.endpointPath || contract.endpointPath === where.endpointPath) &&
              (!where.resourceName || contract.resourceName === where.resourceName) &&
              (!where.status || contract.status === where.status)
          ) ?? null
        );
      }
    }
  };

  return { store, drafts };
}

describe("draft contract service", () => {
  it("can create a draft", async () => {
    const { store } = createMemoryStore();
    const service = createDraftContractService(store);

    const created = await service.createDraftContract({
      apiConnectionId: "connection-1",
      contract: draftContract(),
      createdBy: "admin"
    });

    expect(created).toMatchObject({
      id: "draft-1",
      apiConnectionId: "connection-1",
      resourceName: "employees",
      endpointPath: "/api/hr/employees",
      status: "draft",
      createdBy: "admin"
    });
    expect(created.draftData.resource).toBe("employees");
  });

  it("can update a draft", async () => {
    const { store } = createMemoryStore();
    const service = createDraftContractService(store);
    const created = await service.createDraftContract({
      apiConnectionId: "connection-1",
      contract: draftContract()
    });

    const updated = await service.updateDraftContract(created.id, {
      contract: draftContract({
        resource: "employeeSummaries",
        endpoint: "/api/hr/employee-summaries"
      }),
      updatedBy: "editor"
    });

    expect(updated.resourceName).toBe("employeeSummaries");
    expect(updated.endpointPath).toBe("/api/hr/employee-summaries");
    expect(updated.updatedBy).toBe("editor");
    expect(await service.getDraftContract(created.id)).toBe(updated);
  });

  it("draft does not appear in published contract lookup", async () => {
    const { store } = createMemoryStore();
    const service = createDraftContractService(store);
    await service.createDraftContract({
      apiConnectionId: "connection-1",
      contract: draftContract()
    });

    const published = await service.getPublishedContractByEndpoint("/api/hr/employees");

    expect(published).toBeNull();
  });

  it("rejects invalid minimal drafts", async () => {
    const { store } = createMemoryStore();
    const service = createDraftContractService(store);

    await expect(
      service.createDraftContract({
        apiConnectionId: "connection-1",
        contract: {
          endpoint: "/api/hr/employees",
          fields: []
        } as unknown as DraftApiContract
      })
    ).rejects.toThrow("resource is required");
  });

  it("archives drafts instead of using them at runtime", async () => {
    const { store } = createMemoryStore();
    const service = createDraftContractService(store);
    const created = await service.createDraftContract({
      apiConnectionId: "connection-1",
      contract: draftContract()
    });

    const archived = await service.archiveDraftContract(created.id, "admin");
    const activeDrafts = await service.listDraftContracts({ apiConnectionId: "connection-1" });
    const allDrafts = await service.listDraftContracts({ apiConnectionId: "connection-1", includeArchived: true });

    expect(archived.status).toBe("archived");
    expect(activeDrafts).toEqual([]);
    expect(allDrafts).toHaveLength(1);
  });
});
