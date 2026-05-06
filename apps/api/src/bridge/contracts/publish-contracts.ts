import type {
  ContractCompiler,
  ContractCompilerDiagnostic
} from "../compiler/index.js";
import {
  validateResolvedApiContract,
  type DraftApiContract,
  type ResolvedApiContract
} from "./index.js";
import type { StoredDraftContract, StoredPublishedContract } from "./draft-contracts.js";

export type ContractPublishResult = {
  publishedContract: StoredPublishedContract;
  versionRecord: StoredContractVersion;
  historyRecord: StoredContractPublishHistory;
  deprecatedPrevious: StoredPublishedContract[];
};

export type StoredContractVersion = {
  id: string;
  apiContractDraftId: string;
  publishedContractId: string | null;
  version: number;
  versionData: ResolvedApiContract;
  createdAt: Date;
  createdBy: string | null;
};

export type StoredContractPublishHistory = {
  id: string;
  publishedContractId: string;
  action: string;
  actor: string | null;
  notes: string | null;
  createdAt: Date;
};

export type PublishContractStore = {
  apiContractDraft: {
    findUnique(args: { where: { id: string } }): Promise<StoredDraftContract | null>;
  };
  publishedContract: {
    findFirst(args: {
      where: { resourceName?: string; endpointPath?: string; status?: string };
      orderBy?: { version?: "asc" | "desc" };
    }): Promise<StoredPublishedContract | null>;
    findMany(args: {
      where: { resourceName?: string; endpointPath?: string; status?: string };
    }): Promise<StoredPublishedContract[]>;
    create(args: {
      data: {
        resourceName: string;
        version: number;
        endpointPath: string;
        contractData: ResolvedApiContract;
        oracleOwner?: string;
        oracleObjectName?: string;
        oracleObjectType?: string;
        status: "active";
        publishedAt: Date;
        publishedBy: string;
      };
    }): Promise<StoredPublishedContract>;
    update(args: {
      where: { id: string };
      data: { status: "deprecated" };
    }): Promise<StoredPublishedContract>;
  };
  apiContractVersion: {
    create(args: {
      data: {
        apiContractDraftId: string;
        publishedContractId: string;
        version: number;
        versionData: ResolvedApiContract;
        createdBy: string;
      };
    }): Promise<StoredContractVersion>;
  };
  contractPublishHistory: {
    create(args: {
      data: {
        publishedContractId: string;
        action: "published";
        actor: string;
        notes?: string;
      };
    }): Promise<StoredContractPublishHistory>;
  };
  compilerDiagnostic: {
    createMany(args: {
      data: Array<{
        apiContractDraftId: string;
        code: string;
        severity: string;
        message: string;
        detail?: Record<string, unknown>;
      }>;
    }): Promise<{ count: number }>;
  };
};

export type ContractPublishService = {
  publishDraftContract(draftId: string, publishedBy: string, changeReason?: string): Promise<ContractPublishResult>;
};

export function createContractPublishService(
  store: PublishContractStore,
  compiler: ContractCompiler
): ContractPublishService {
  return {
    async publishDraftContract(draftId, publishedBy, changeReason) {
      const draft = await store.apiContractDraft.findUnique({ where: { id: draftId } });
      if (!draft) {
        throw new Error(`Draft contract not found: ${draftId}`);
      }

      const latest = await store.publishedContract.findFirst({
        where: {
          resourceName: draft.resourceName
        },
        orderBy: { version: "desc" }
      });
      const version = (latest?.version ?? 0) + 1;
      const compileResult = await compiler.compile({
        apiConnectionId: draft.apiConnectionId,
        draft: draft.draftData as DraftApiContract,
        version,
        compiledBy: publishedBy
      });

      if (!compileResult.contract) {
        await storeDiagnostics(store, draftId, compileResult.diagnostics);
        throw new Error("Draft contract failed compilation.");
      }

      const metaValidation = validateResolvedApiContract(compileResult.contract);
      if (!metaValidation.success) {
        await storeDiagnostics(
          store,
          draftId,
          metaValidation.issues.map((issue) => ({
            code: "RESOLVED_CONTRACT_SCHEMA_INVALID",
            message: issue.message,
            path: issue.path,
            severity: "error"
          }))
        );
        throw new Error("Resolved contract failed meta-schema validation.");
      }

      const previousActive = await store.publishedContract.findMany({
        where: {
          resourceName: draft.resourceName,
          endpointPath: draft.endpointPath,
          status: "active"
        }
      });
      const deprecatedPrevious = [];
      for (const previous of previousActive) {
        deprecatedPrevious.push(
          await store.publishedContract.update({
            where: { id: previous.id },
            data: { status: "deprecated" }
          })
        );
      }

      const publishedContract = await store.publishedContract.create({
        data: {
          resourceName: draft.resourceName,
          version,
          endpointPath: draft.endpointPath,
          contractData: metaValidation.data,
          oracleOwner: draft.draftData.source.owner,
          oracleObjectName: draft.draftData.source.name ?? draft.draftData.source.procedureName,
          oracleObjectType: draft.draftData.source.type,
          status: "active",
          publishedAt: metaValidation.data.publishedAt,
          publishedBy
        }
      });

      const versionRecord = await store.apiContractVersion.create({
        data: {
          apiContractDraftId: draft.id,
          publishedContractId: publishedContract.id,
          version,
          versionData: metaValidation.data,
          createdBy: publishedBy
        }
      });

      const historyRecord = await store.contractPublishHistory.create({
        data: {
          publishedContractId: publishedContract.id,
          action: "published",
          actor: publishedBy,
          notes: changeReason
        }
      });

      return {
        publishedContract,
        versionRecord,
        historyRecord,
        deprecatedPrevious
      };
    }
  };
}

async function storeDiagnostics(
  store: PublishContractStore,
  draftId: string,
  diagnostics: ContractCompilerDiagnostic[]
): Promise<void> {
  if (diagnostics.length === 0) {
    return;
  }

  await store.compilerDiagnostic.createMany({
    data: diagnostics.map((diagnostic) => ({
      apiContractDraftId: draftId,
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      detail: diagnostic.path ? { path: diagnostic.path } : undefined
    }))
  });
}
