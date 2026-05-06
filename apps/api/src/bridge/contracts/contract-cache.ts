import {
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
    // For now, endpointPath is enough, assuming method mapping or using just path.
    // We can include method if needed later, but the requirements just say "getContractByEndpoint(method/path)"
    // Let's use endpointPath for simplicity as contracts seem to be defined by endpointPath
    return endpointPath.toLowerCase();
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
          const key = buildCacheKey("GET", contract.endpointPath); // Method is placeholder for now unless specified
          newMap.set(key, validation.data);
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

      if (!contract) {
        logger.warn(`Contract ${contractId} not found during reload.`);
        return;
      }

      if (contract.status !== "active") {
        logger.warn(`Contract ${contractId} is not active. Ignoring.`);
        return;
      }

      const validation = validateResolvedApiContract(contract.contractData);
      if (validation.success) {
        const key = buildCacheKey("GET", contract.endpointPath);
        contractsMap.set(key, validation.data);
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
