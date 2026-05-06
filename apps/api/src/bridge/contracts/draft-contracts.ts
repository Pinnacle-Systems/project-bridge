import type { DraftApiContract, ResolvedApiContract } from "./index.js";
import { buildContractAuditMetadata, type AuditLogger } from "../audit/index.js";

export type DraftContractStatus = "draft" | "archived";

export type StoredDraftContract = {
  id: string;
  apiConnectionId: string;
  resourceName: string;
  endpointPath: string;
  draftData: DraftApiContract;
  status: DraftContractStatus;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredPublishedContract = {
  id: string;
  resourceName: string;
  version: number;
  endpointPath: string;
  contractData: ResolvedApiContract;
  status: string;
};

export type CreateDraftContractInput = {
  apiConnectionId: string;
  contract: DraftApiContract;
  createdBy?: string;
};

export type UpdateDraftContractInput = {
  contract?: DraftApiContract;
  updatedBy?: string;
};

export type ListDraftContractsInput = {
  apiConnectionId?: string;
  includeArchived?: boolean;
};

export type BridgeContractStore = {
  apiContractDraft: {
    create(args: {
      data: {
        apiConnectionId: string;
        resourceName: string;
        endpointPath: string;
        draftData: DraftApiContract;
        status: DraftContractStatus;
        createdBy?: string;
      };
    }): Promise<StoredDraftContract>;
    update(args: {
      where: { id: string };
      data: Partial<Pick<StoredDraftContract, "resourceName" | "endpointPath" | "draftData" | "status" | "updatedBy">>;
    }): Promise<StoredDraftContract>;
    findUnique(args: { where: { id: string } }): Promise<StoredDraftContract | null>;
    findMany(args?: {
      where?: {
        apiConnectionId?: string;
        status?: DraftContractStatus;
      };
      orderBy?: { updatedAt?: "asc" | "desc"; createdAt?: "asc" | "desc" };
    }): Promise<StoredDraftContract[]>;
  };
  publishedContract: {
    findFirst(args: {
      where: {
        endpointPath?: string;
        resourceName?: string;
        status?: string;
      };
      orderBy?: { version?: "asc" | "desc" };
    }): Promise<StoredPublishedContract | null>;
  };
};

export type DraftContractService = {
  createDraftContract(input: CreateDraftContractInput): Promise<StoredDraftContract>;
  updateDraftContract(id: string, input: UpdateDraftContractInput): Promise<StoredDraftContract>;
  getDraftContract(id: string): Promise<StoredDraftContract | null>;
  listDraftContracts(input?: ListDraftContractsInput): Promise<StoredDraftContract[]>;
  archiveDraftContract(id: string, updatedBy?: string): Promise<StoredDraftContract>;
  getPublishedContractByEndpoint(endpointPath: string): Promise<StoredPublishedContract | null>;
};

export function createDraftContractService(store: BridgeContractStore, audit?: AuditLogger): DraftContractService {
  return {
    async createDraftContract(input) {
      validateDraftContract(input.contract);

      const draft = await store.apiContractDraft.create({
        data: {
          apiConnectionId: input.apiConnectionId,
          resourceName: input.contract.resource,
          endpointPath: input.contract.endpoint,
          draftData: input.contract,
          status: "draft",
          createdBy: input.createdBy
        }
      });
      audit?.log({
        type: "contract.draft.created",
        actor: input.createdBy,
        metadata: buildContractAuditMetadata({
          resource: input.contract.resource,
          endpoint: input.contract.endpoint,
          actor: input.createdBy,
          status: "draft"
        })
      });
      return draft;
    },

    async updateDraftContract(id, input) {
      if (input.contract) {
        validateDraftContract(input.contract);
      }

      const draft = await store.apiContractDraft.update({
        where: { id },
        data: {
          ...(input.contract
            ? {
                resourceName: input.contract.resource,
                endpointPath: input.contract.endpoint,
                draftData: input.contract
              }
            : {}),
          updatedBy: input.updatedBy
        }
      });
      audit?.log({
        type: "contract.draft.updated",
        actor: input.updatedBy,
        metadata: buildContractAuditMetadata({
          resource: draft.resourceName,
          endpoint: draft.endpointPath,
          actor: input.updatedBy,
          status: draft.status
        })
      });
      return draft;
    },

    async getDraftContract(id) {
      return store.apiContractDraft.findUnique({ where: { id } });
    },

    async listDraftContracts(input = {}) {
      return store.apiContractDraft.findMany({
        where: {
          apiConnectionId: input.apiConnectionId,
          status: input.includeArchived ? undefined : "draft"
        },
        orderBy: { updatedAt: "desc" }
      });
    },

    async archiveDraftContract(id, updatedBy) {
      const draft = await store.apiContractDraft.update({
        where: { id },
        data: {
          status: "archived",
          updatedBy
        }
      });
      audit?.log({
        type: "contract.retired",
        actor: updatedBy,
        metadata: buildContractAuditMetadata({
          resource: draft.resourceName,
          endpoint: draft.endpointPath,
          actor: updatedBy,
          status: draft.status
        })
      });
      return draft;
    },

    async getPublishedContractByEndpoint(endpointPath) {
      return store.publishedContract.findFirst({
        where: {
          endpointPath,
          status: "active"
        },
        orderBy: { version: "desc" }
      });
    }
  };
}

export function validateDraftContract(contract: DraftApiContract): void {
  if (!isNonEmptyString(contract.resource)) {
    throw new Error("Draft contract resource is required.");
  }
  if (!isNonEmptyString(contract.endpoint)) {
    throw new Error("Draft contract endpoint is required.");
  }
  if (!contract.source || typeof contract.source !== "object") {
    throw new Error("Draft contract source is required.");
  }
  if (!Array.isArray(contract.fields)) {
    throw new Error("Draft contract fields array is required.");
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
