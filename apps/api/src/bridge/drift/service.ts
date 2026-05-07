import { validateResolvedApiContract } from "../contracts/index.js";
import type { OracleSchemaSnapshot } from "../oracleInspector/index.js";
import { checkContractDrift } from "./checker.js";
import type { DriftServiceStore, StoredDriftReport } from "./types.js";

export type DriftServiceOptions = {
  store: DriftServiceStore;
  /**
   * Provide a fresh Oracle snapshot for the given connection ID and owner.
   * Called once per contract during a drift check.
   */
  getSnapshot(connectionId: string, owner: string): Promise<OracleSchemaSnapshot>;
};

export type DriftService = {
  /** Run a drift check for a single published contract and persist the result. */
  runDriftCheck(contractId: string): Promise<StoredDriftReport>;
  /** Run a drift check for every active published contract and persist the results. */
  runDriftCheckForAllActiveContracts(): Promise<StoredDriftReport[]>;
};

export function createDriftService(options: DriftServiceOptions): DriftService {
  const { store, getSnapshot } = options;

  async function runDriftCheck(contractId: string): Promise<StoredDriftReport> {
    const stored = await store.publishedContract.findUnique({ where: { id: contractId } });
    if (!stored) throw new Error(`Contract not found: ${contractId}`);

    const validation = validateResolvedApiContract(stored.contractData);
    if (!validation.success) {
      const summary = validation.issues.map(i => i.message).join("; ");
      throw new Error(`Contract ${contractId} failed validation: ${summary}`);
    }

    const contract = validation.data;
    const snapshot = await getSnapshot(contract.source.database, contract.source.owner);
    const result = checkContractDrift(contract, snapshot);

    return store.schemaDriftReport.create({
      data: {
        publishedContractId: contractId,
        severity: result.status,
        status: "open",
        reportData: result
      }
    });
  }

  async function runDriftCheckForAllActiveContracts(): Promise<StoredDriftReport[]> {
    const contracts = await store.publishedContract.findMany({ where: { status: "active" } });
    const results: StoredDriftReport[] = [];

    for (const stored of contracts) {
      const validation = validateResolvedApiContract(stored.contractData);
      if (!validation.success) continue;

      try {
        results.push(await runDriftCheck(stored.id));
      } catch {
        // Skip contracts where Oracle is unreachable or the contract itself is broken
      }
    }

    return results;
  }

  return { runDriftCheck, runDriftCheckForAllActiveContracts };
}
