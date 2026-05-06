export type DriftSeverity = "none" | "minor" | "breaking";

export type SchemaDriftReport = {
  id: string;
  contractResourceName: string;
  checkedAt: Date;
  severity: DriftSeverity;
  findings: string[];
};
