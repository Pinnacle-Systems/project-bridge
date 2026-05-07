export type {
  DriftStatus,
  DriftFindingSeverity,
  DriftFindingCategory,
  DriftFinding,
  DriftCheckResult,
  StoredDriftReport,
  DriftServiceStore
} from "./types.js";

export { checkContractDrift } from "./checker.js";
export { createDriftService } from "./service.js";
export type { DriftService, DriftServiceOptions } from "./service.js";

// ─── Legacy aliases ─────────────────────────────────────────────────────────

/** @deprecated Use DriftStatus */
export type DriftSeverity = import("./types.js").DriftStatus;

/** @deprecated Use DriftCheckResult */
export type SchemaDriftReport = {
  id: string;
  contractResourceName: string;
  checkedAt: Date;
  severity: import("./types.js").DriftStatus;
  findings: string[];
};
