import type { BridgeHttpContext } from "./context.js";
import type { CreateOracleConnectionInput } from "../connections/index.js";
import type { DraftApiContract } from "../contracts/index.js";

export type AdminHandlerOutput = { status: number; body: unknown };

export type AdminHandlers = {
  // Connections
  createConnection(body: unknown): Promise<AdminHandlerOutput>;
  listConnections(): Promise<AdminHandlerOutput>;
  getConnection(id: string): Promise<AdminHandlerOutput>;
  testConnection(id: string): Promise<AdminHandlerOutput>;
  detectCapabilities(id: string): Promise<AdminHandlerOutput>;
  // Schema inspection
  inspectSchema(connectionId: string, body: unknown): Promise<AdminHandlerOutput>;
  listSnapshots(connectionId?: string): Promise<AdminHandlerOutput>;
  getSnapshot(id: string): Promise<AdminHandlerOutput>;
  // Drafts
  createDraft(body: unknown): Promise<AdminHandlerOutput>;
  getDraft(id: string): Promise<AdminHandlerOutput>;
  updateDraft(id: string, body: unknown): Promise<AdminHandlerOutput>;
  listDrafts(query?: { apiConnectionId?: string; includeArchived?: string }): Promise<AdminHandlerOutput>;
  archiveDraft(id: string): Promise<AdminHandlerOutput>;
  // Compiler
  validateDraft(body: unknown): Promise<AdminHandlerOutput>;
  compileDraft(body: unknown): Promise<AdminHandlerOutput>;
  // Publish
  publishDraft(draftId: string, body: unknown): Promise<AdminHandlerOutput>;
  // Published
  listPublished(): Promise<AdminHandlerOutput>;
  getPublished(id: string): Promise<AdminHandlerOutput>;
  // Cache
  reloadCache(): Promise<AdminHandlerOutput>;
  getCacheStatus(): Promise<AdminHandlerOutput>;
  // Diagnostics
  getCompilerDiagnostics(draftId?: string): Promise<AdminHandlerOutput>;
  getAuditLogs(query?: { type?: string; take?: string }): Promise<AdminHandlerOutput>;
};

export function createAdminHandlers(ctx: BridgeHttpContext): AdminHandlers {
  return {
    // ── Connections ──────────────────────────────────────────────────────────

    async createConnection(body) {
      const validation = validateCreateConnectionBody(body);
      if (!validation.ok) {
        return validation.output;
      }

      const connection = await ctx.connections.createConnection(validation.input);
      return { status: 201, body: { data: connection } };
    },

    async listConnections() {
      const connections = await ctx.connections.listConnections();
      return { status: 200, body: { data: connections } };
    },

    async getConnection(id) {
      const connection = await ctx.connections.getConnectionSafe(id);
      if (!connection) return { status: 404, body: { error: "Connection not found." } };
      return { status: 200, body: { data: connection } };
    },

    async testConnection(id) {
      const capabilities = await ctx.capabilityDetector.detectOracleCapabilities(id);
      await ctx.connections.markConnectionStatus(id, "active");
      return { status: 200, body: { success: true, data: capabilities } };
    },

    async detectCapabilities(id) {
      const capabilities = await ctx.capabilityDetector.detectOracleCapabilities(id);
      return { status: 200, body: { data: capabilities } };
    },

    // ── Schema inspection ────────────────────────────────────────────────────

    async inspectSchema(connectionId, body) {
      const { owner } = (body ?? {}) as { owner?: string };
      if (!owner) return { status: 400, body: { error: "owner is required." } };
      const result = await ctx.inspector.inspectOracleSchema(connectionId, owner);
      return { status: 201, body: { data: result.storedSnapshot } };
    },

    async listSnapshots(connectionId) {
      const snapshots = await ctx.store.oracleSchemaSnapshot.findMany({
        where: connectionId ? { apiConnectionId: connectionId } : undefined,
        orderBy: { capturedAt: "desc" }
      });
      return { status: 200, body: { data: snapshots } };
    },

    async getSnapshot(id) {
      const snapshot = await ctx.store.oracleSchemaSnapshot.findUnique({ where: { id } });
      if (!snapshot) return { status: 404, body: { error: "Snapshot not found." } };
      return { status: 200, body: { data: snapshot } };
    },

    // ── Drafts ───────────────────────────────────────────────────────────────

    async createDraft(body) {
      const { apiConnectionId, contract } = (body ?? {}) as {
        apiConnectionId?: string;
        contract?: DraftApiContract;
      };
      if (!apiConnectionId) return { status: 400, body: { error: "apiConnectionId is required." } };
      if (!contract) return { status: 400, body: { error: "contract is required." } };
      const draft = await ctx.drafts.createDraftContract({ apiConnectionId, contract });
      return { status: 201, body: { data: draft } };
    },

    async getDraft(id) {
      const draft = await ctx.drafts.getDraftContract(id);
      if (!draft) return { status: 404, body: { error: "Draft not found." } };
      return { status: 200, body: { data: draft } };
    },

    async updateDraft(id, body) {
      const { contract } = (body ?? {}) as { contract?: DraftApiContract };
      const draft = await ctx.drafts.updateDraftContract(id, { contract });
      return { status: 200, body: { data: draft } };
    },

    async listDrafts(query) {
      const drafts = await ctx.drafts.listDraftContracts({
        apiConnectionId: query?.apiConnectionId,
        includeArchived: query?.includeArchived === "true"
      });
      return { status: 200, body: { data: drafts } };
    },

    async archiveDraft(id) {
      const draft = await ctx.drafts.archiveDraftContract(id);
      return { status: 200, body: { data: draft } };
    },

    // ── Compiler ─────────────────────────────────────────────────────────────

    async validateDraft(body) {
      const { apiConnectionId, contract } = (body ?? {}) as {
        apiConnectionId?: string;
        contract?: DraftApiContract;
      };
      if (!apiConnectionId) return { status: 400, body: { error: "apiConnectionId is required." } };
      if (!contract) return { status: 400, body: { error: "contract is required." } };
      const result = await ctx.compiler.compile({ apiConnectionId, draft: contract });
      const ok = !result.diagnostics.some(d => d.severity === "error");
      return {
        status: ok ? 200 : 422,
        body: { valid: ok, contract: result.contract ?? null, diagnostics: result.diagnostics }
      };
    },

    async compileDraft(body) {
      const { apiConnectionId, contract, version } = (body ?? {}) as {
        apiConnectionId?: string;
        contract?: DraftApiContract;
        version?: number;
      };
      if (!apiConnectionId) return { status: 400, body: { error: "apiConnectionId is required." } };
      if (!contract) return { status: 400, body: { error: "contract is required." } };
      const result = await ctx.compiler.compile({ apiConnectionId, draft: contract, version });
      const ok = !result.diagnostics.some(d => d.severity === "error");
      if (!ok) return { status: 422, body: { error: "Compilation failed.", diagnostics: result.diagnostics } };
      return { status: 200, body: { data: result.contract, diagnostics: result.diagnostics } };
    },

    // ── Publish ──────────────────────────────────────────────────────────────

    async publishDraft(draftId, body) {
      const { publishedBy, changeReason } = (body ?? {}) as {
        publishedBy?: string;
        changeReason?: string;
      };
      if (!publishedBy) return { status: 400, body: { error: "publishedBy is required." } };
      const result = await ctx.publisher.publishDraftContract(draftId, publishedBy, changeReason);
      return { status: 201, body: { data: result.publishedContract } };
    },

    // ── Published contracts ──────────────────────────────────────────────────

    async listPublished() {
      const contracts = await ctx.store.publishedContract.findMany({
        where: { status: "active" }
      });
      return { status: 200, body: { data: contracts } };
    },

    async getPublished(id) {
      const contract = await ctx.store.publishedContract.findUnique({ where: { id } });
      if (!contract) return { status: 404, body: { error: "Published contract not found." } };
      return { status: 200, body: { data: contract } };
    },

    // ── Cache ────────────────────────────────────────────────────────────────

    async reloadCache() {
      await ctx.cache.reloadAllContracts();
      return { status: 200, body: { success: true } };
    },

    async getCacheStatus() {
      return { status: 200, body: { status: "ok" } };
    },

    // ── Diagnostics ──────────────────────────────────────────────────────────

    async getCompilerDiagnostics(draftId) {
      const diagnostics = await ctx.store.compilerDiagnostic.findMany({
        where: draftId ? { apiContractDraftId: draftId } : undefined,
        orderBy: { createdAt: "desc" }
      });
      return { status: 200, body: { data: diagnostics } };
    },

    async getAuditLogs(query) {
      const take = query?.take ? parseInt(query.take, 10) : 100;
      const logs = await ctx.store.auditLog.findMany({
        where: query?.type ? { eventType: query.type } : undefined,
        orderBy: { occurredAt: "desc" },
        take
      });
      return { status: 200, body: { data: logs } };
    }
  };
}

type ValidationResult<T> =
  | { ok: true; input: T }
  | { ok: false; output: AdminHandlerOutput };

function validateCreateConnectionBody(body: unknown): ValidationResult<CreateOracleConnectionInput> {
  if (!isRecord(body)) {
    return invalidRequest("Request body must be a JSON object.", [
      { field: "body", message: "Send a JSON object with name, connectionType, and username." }
    ]);
  }

  const details: Array<{ field: string; message: string }> = [];
  requireStringField(body, "name", details);
  requireStringField(body, "connectionType", details);
  requireStringField(body, "username", details);

  if (typeof body.connectionType === "string" && !isConnectionType(body.connectionType)) {
    details.push({
      field: "connectionType",
      message: "Must be one of: serviceName, sid, tnsAlias, wallet."
    });
  }

  const port = body.port;
  if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port) || port <= 0)) {
    details.push({ field: "port", message: "Must be a positive integer when provided." });
  }

  if (details.length > 0) {
    return invalidRequest("Connection request is invalid.", details);
  }

  return { ok: true, input: body as CreateOracleConnectionInput };
}

function invalidRequest(message: string, details: Array<{ field: string; message: string }>): ValidationResult<never> {
  return {
    ok: false,
    output: {
      status: 400,
      body: {
        error: {
          code: "INVALID_REQUEST",
          message,
          details
        }
      }
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireStringField(
  body: Record<string, unknown>,
  field: string,
  details: Array<{ field: string; message: string }>
): void {
  if (typeof body[field] !== "string" || body[field].trim() === "") {
    details.push({ field, message: "Required string field is missing or empty." });
  }
}

function isConnectionType(value: string): value is CreateOracleConnectionInput["connectionType"] {
  return value === "serviceName" || value === "sid" || value === "tnsAlias" || value === "wallet";
}
