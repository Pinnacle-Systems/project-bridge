export type DriftStatus = "healthy" | "warning" | "drifted" | "broken";

export type DriftFindingSeverity = Exclude<DriftStatus, "healthy">;

export type DriftFindingCategory = "object" | "column" | "sequence" | "procedure" | "argument";

export type DriftFinding = {
  severity: DriftFindingSeverity;
  category: DriftFindingCategory;
  message: string;
  detail?: string;
};

export type DriftCheckResult = {
  contractId: string;
  contractVersion: number;
  oracleOwner: string;
  oracleObject: string;
  checkedAt: Date;
  status: DriftStatus;
  findings: DriftFinding[];
};

export type StoredDriftReport = {
  id: string;
  publishedContractId: string;
  /** DriftStatus stored as a plain string in the DB. */
  severity: string;
  status: "open" | "resolved";
  reportData: DriftCheckResult;
  checkedAt: Date;
  resolvedAt: Date | null;
};

export type DriftServiceStore = {
  publishedContract: {
    findMany(args: { where: { status: string } }): Promise<Array<{ id: string; contractData: unknown }>>;
    findUnique(args: { where: { id: string } }): Promise<{ id: string; contractData: unknown } | null>;
  };
  schemaDriftReport: {
    create(args: {
      data: {
        publishedContractId: string;
        severity: string;
        status: string;
        reportData: unknown;
      };
    }): Promise<StoredDriftReport>;
  };
};
