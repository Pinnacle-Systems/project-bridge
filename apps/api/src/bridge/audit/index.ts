export type AuditEventType =
  | "contract.draft.created"
  | "contract.compiled"
  | "contract.published"
  | "runtime.request.received"
  | "runtime.request.failed";

export type AuditEvent = {
  id: string;
  type: AuditEventType;
  occurredAt: Date;
  actor?: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogger = {
  log(event: Omit<AuditEvent, "id" | "occurredAt">): void;
};
