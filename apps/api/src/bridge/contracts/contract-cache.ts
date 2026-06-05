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
  tenantId?: string | null;
  apiConnectionId?: string | null;
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

export type ScopedEndpointContext = {
  tenantId: string;
  apiConnectionId: string;
  method: string;
  endpointPath: string;
};

export type ScopedContractResult = {
  contract: ResolvedApiContract;
  publishedContractId: string;
};

export type ContractCache = {
  loadActiveContracts(): Promise<void>;
  /** Runtime contract resolution — always requires tenantId + apiConnectionId. Returns contract + publishedContractId for audit tracing. */
  getContractByScopedEndpoint(ctx: ScopedEndpointContext): ScopedContractResult | undefined;
  /**
   * Legacy unscoped lookup — method + path only.
   * NOT used by the /api/* runtime dispatcher (Phase 9e+).
   * Retained for legacy migration tooling and contracts without tenant metadata.
   */
  getContractByEndpoint(method: string, path: string): ResolvedApiContract | undefined;
  reloadContract(contractId: string): Promise<void>;
  reloadAllContracts(): Promise<void>;
};

export type CacheLogger = {
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

export function createContractCache(store: ContractCacheStore, logger: CacheLogger = console): ContractCache {
  type CachedContract = {
    publishedContractId: string;
    contract: ResolvedApiContract;
  };

  // Tenant-scoped contracts: key = tenantId:apiConnectionId:METHOD:endpointPath
  let scopedMap = new Map<string, CachedContract>();
  // Legacy unscoped contracts: key = METHOD:endpointPath (backward compat only)
  let legacyMap = new Map<string, CachedContract>();

  const buildScopedCacheKey = (tenantId: string, apiConnectionId: string, method: string, endpointPath: string): string =>
    `${tenantId}:${apiConnectionId}:${method.toUpperCase()}:${endpointPath.toLowerCase()}`;

  const buildLegacyCacheKey = (method: string, endpointPath: string): string =>
    `${method.toUpperCase()}:${endpointPath.toLowerCase()}`;

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

  const indexContract = (
    row: StoredPublishedContractForCache,
    contract: ResolvedApiContract,
    target: { scoped: Map<string, CachedContract>; legacy: Map<string, CachedContract> }
  ): void => {
    const tenantId = row.tenantId ?? contract.runtime.tenantId ?? null;
    const apiConnectionId = row.apiConnectionId ?? contract.runtime.apiConnectionId ?? null;
    const methods = getHttpMethodsForContract(contract);

    if (tenantId && apiConnectionId) {
      for (const method of methods) {
        const key = buildScopedCacheKey(tenantId, apiConnectionId, method, row.endpointPath);
        target.scoped.set(key, { publishedContractId: row.id, contract });
      }
    } else {
      for (const method of methods) {
        const key = buildLegacyCacheKey(method, row.endpointPath);
        target.legacy.set(key, { publishedContractId: row.id, contract });
      }
    }
  };

  return {
    async loadActiveContracts() {
      const activeContracts = await store.publishedContract.findMany({
        where: { status: "active" }
      });

      const newScoped = new Map<string, CachedContract>();
      const newLegacy = new Map<string, CachedContract>();

      for (const row of activeContracts) {
        const validation = validateResolvedApiContract(row.contractData);
        if (!validation.success) {
          logger.warn(
            `Failed to validate contract schema for active contract ${row.id}:`,
            validation.issues
          );
          continue;
        }
        if (validation.data.runtime.schemaVersion !== SCHEMA_VERSION) {
          logger.warn(`Contract ${row.id} uses unsupported schema version ${validation.data.runtime.schemaVersion}. Skipping.`);
          continue;
        }
        indexContract(row, validation.data, { scoped: newScoped, legacy: newLegacy });
      }

      scopedMap = newScoped;
      legacyMap = newLegacy;
    },

    getContractByScopedEndpoint({ tenantId, apiConnectionId, method, endpointPath }) {
      const key = buildScopedCacheKey(tenantId, apiConnectionId, method, endpointPath);
      const entry = scopedMap.get(key);
      if (!entry) return undefined;
      return { contract: entry.contract, publishedContractId: entry.publishedContractId };
    },

    getContractByEndpoint(method: string, path: string) {
      const key = buildLegacyCacheKey(method, path);
      return legacyMap.get(key)?.contract;
    },

    async reloadContract(contractId: string) {
      const row = await store.publishedContract.findUnique({
        where: { id: contractId }
      });

      if (!row || row.status !== "active") {
        let removed = false;
        for (const [key, cached] of scopedMap.entries()) {
          if (cached.publishedContractId === contractId || cached.contract.id === contractId) {
            scopedMap.delete(key);
            removed = true;
          }
        }
        for (const [key, cached] of legacyMap.entries()) {
          if (cached.publishedContractId === contractId || cached.contract.id === contractId) {
            legacyMap.delete(key);
            removed = true;
          }
        }
        logger.warn(`Contract ${contractId} is not active or not found.${removed ? ' Removed from cache.' : ''} Ignoring.`);
        return;
      }

      const validation = validateResolvedApiContract(row.contractData);
      if (!validation.success) {
        logger.warn(
          `Failed to validate contract schema during reload for contract ${row.id}:`,
          validation.issues
        );
        return;
      }
      if (validation.data.runtime.schemaVersion !== SCHEMA_VERSION) {
        logger.warn(`Contract ${contractId} uses unsupported schema version ${validation.data.runtime.schemaVersion}. Skipping.`);
        return;
      }

      // Evict all existing keys for this contract (endpoint or operations may have changed)
      for (const [key, cached] of scopedMap.entries()) {
        if (cached.publishedContractId === contractId || cached.contract.id === contractId) {
          scopedMap.delete(key);
        }
      }
      for (const [key, cached] of legacyMap.entries()) {
        if (cached.publishedContractId === contractId || cached.contract.id === contractId) {
          legacyMap.delete(key);
        }
      }

      indexContract(row, validation.data, { scoped: scopedMap, legacy: legacyMap });
    },

    async reloadAllContracts() {
      const prevScoped = scopedMap;
      const prevLegacy = legacyMap;
      try {
        await this.loadActiveContracts();
      } catch (error) {
        logger.error("Failed to reload all contracts. Keeping previous cache.", error);
        scopedMap = prevScoped;
        legacyMap = prevLegacy;
      }
    }
  };
}
