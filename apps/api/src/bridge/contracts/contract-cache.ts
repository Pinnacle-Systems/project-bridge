import {
  SCHEMA_VERSION,
  validateResolvedApiContract,
  type ResolvedApiContract
} from "./index.js";

export type StoredPublishedContractForCache = {
  id: string;
  endpointPath: string;
  contractData: unknown;
  status: string;
};

export type ContractCacheStore = {
  publishedContract: {
    findMany(args: {
      where: { status: string };
    }): Promise<StoredPublishedContractForCache[]>;
    findUnique(args: {
      where: { id: string };
    }): Promise<StoredPublishedContractForCache | null>;
  };
};

export type ContractCache = {
  loadActiveContracts(): Promise<void>;
  getContractByEndpoint(method: string, path: string): ResolvedApiContract | undefined;
  reloadContract(contractId: string): Promise<void>;
  reloadAllContracts(): Promise<void>;
};

export type CacheLogger = {
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

export function createContractCache(store: ContractCacheStore, logger: CacheLogger = console): ContractCache {
  let contractsMap = new Map<string, ResolvedApiContract>();

  const buildCacheKey = (method: string, endpointPath: string) => {
    return `${method.toUpperCase()}:${endpointPath.toLowerCase()}`;
  };

  const getHttpMethodsForContract = (contract: ResolvedApiContract): string[] => {
    const methods = new Set<string>();
    for (const op of contract.operations) {
      if (!op.enabled) continue;
      switch (op.operation) {
        case "read":
        case "list":
          methods.add("GET");
          break;
        case "create":
          methods.add("POST");
          break;
        case "update":
          methods.add("PUT");
          methods.add("PATCH");
          break;
        case "delete":
          methods.add("DELETE");
          break;
      }
    }
    return Array.from(methods);
  };

  return {
    async loadActiveContracts() {
      const activeContracts = await store.publishedContract.findMany({
        where: { status: "active" }
      });

      const newMap = new Map<string, ResolvedApiContract>();

      for (const contract of activeContracts) {
        const validation = validateResolvedApiContract(contract.contractData);
        if (validation.success) {
          if (validation.data.runtime.schemaVersion !== SCHEMA_VERSION) {
            logger.warn(`Contract ${contract.id} uses unsupported schema version ${validation.data.runtime.schemaVersion}. Skipping.`);
            continue;
          }
          const methods = getHttpMethodsForContract(validation.data);
          for (const method of methods) {
            const key = buildCacheKey(method, contract.endpointPath);
            newMap.set(key, validation.data);
          }
        } else {
          logger.warn(
            `Failed to validate contract schema for active contract ${contract.id}:`,
            validation.issues
          );
        }
      }

      contractsMap = newMap;
    },

    getContractByEndpoint(method: string, path: string) {
      const key = buildCacheKey(method, path);
      return contractsMap.get(key);
    },

    async reloadContract(contractId: string) {
      const contract = await store.publishedContract.findUnique({
        where: { id: contractId }
      });

      if (!contract || contract.status !== "active") {
        let removed = false;
        for (const [existingKey, existingContract] of contractsMap.entries()) {
          if (existingContract.id === contractId) {
            contractsMap.delete(existingKey);
            removed = true;
          }
        }
        logger.warn(`Contract ${contractId} is not active or not found.${removed ? ' Removed from cache.' : ''} Ignoring.`);
        return;
      }

      const validation = validateResolvedApiContract(contract.contractData);
      if (validation.success) {
        if (validation.data.runtime.schemaVersion !== SCHEMA_VERSION) {
          logger.warn(`Contract ${contractId} uses unsupported schema version ${validation.data.runtime.schemaVersion}. Skipping.`);
          return;
        }

        // Remove all old keys for this contract ID (endpoint or operations might have changed)
        for (const [existingKey, existingContract] of contractsMap.entries()) {
          if (existingContract.id === contractId) {
            contractsMap.delete(existingKey);
          }
        }
        
        const methods = getHttpMethodsForContract(validation.data);
        for (const method of methods) {
          const key = buildCacheKey(method, contract.endpointPath);
          contractsMap.set(key, validation.data);
        }
      } else {
        logger.warn(
          `Failed to validate contract schema during reload for contract ${contract.id}:`,
          validation.issues
        );
      }
    },

    async reloadAllContracts() {
      const oldMap = contractsMap;
      try {
        await this.loadActiveContracts();
      } catch (error) {
        logger.error("Failed to reload all contracts. Keeping previous cache.", error);
        contractsMap = oldMap;
      }
    }
  };
}
