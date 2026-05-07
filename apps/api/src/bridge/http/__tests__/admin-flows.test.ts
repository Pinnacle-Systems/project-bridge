import { describe, expect, it, vi } from "vitest";
import { createAdminHandlers } from "../admin-handlers.js";
import { createRuntimeDispatcher } from "../runtime-router.js";
import type { BridgeHttpContext } from "../context.js";
import type { OracleConnectionSafe } from "../../connections/index.js";
import type { StoredOracleSchemaSnapshot, OracleSchemaSnapshot } from "../../oracleInspector/index.js";
import type { StoredDraftContract, StoredPublishedContract } from "../../contracts/index.js";
import type { ResolvedApiContract } from "../../contracts/index.js";

// ─── Factories ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-07T00:00:00.000Z");

function safeConnection(id = "conn-1"): OracleConnectionSafe {
  return {
    id,
    name: "Test DB",
    connectionType: "serviceName",
    host: "db.example.com",
    port: 1521,
    serviceName: "ORCL",
    sid: null,
    tnsAlias: null,
    username: "HR",
    defaultOwner: "HR",
    oracleVersion: null,
    paginationStrategy: null,
    status: "unverified",
    createdAt: NOW,
    updatedAt: NOW,
    hasEncryptedPassword: false,
    hasPasswordSecret: false,
    hasWalletPath: false,
    hasWalletSecret: false
  };
}

function storedDraft(id = "draft-1"): StoredDraftContract {
  return {
    id,
    apiConnectionId: "conn-1",
    resourceName: "employees",
    endpointPath: "/api/hr/employees",
    draftData: {
      resource: "employees",
      endpoint: "/api/hr/employees",
      source: { database: "db1", owner: "HR", type: "table", name: "EMPLOYEES" },
      fields: [{ apiField: "id", apiType: "integer", dbColumn: "EMPLOYEE_ID", oracleType: "number" }],
      operations: [{ operation: "list", enabled: true }]
    },
    status: "draft",
    createdBy: "admin",
    updatedBy: null,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function storedPublished(id = "pub-1"): StoredPublishedContract {
  return {
    id,
    resourceName: "employees",
    version: 1,
    endpointPath: "/api/hr/employees",
    contractData: resolvedContract(),
    status: "active"
  };
}

function resolvedContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "conn-1:employees:1",
    resource: "employees",
    endpoint: "/api/hr/employees",
    version: 1,
    status: "active",
    publishedAt: NOW,
    publishedBy: "admin",
    source: { database: "db1", owner: "HR", type: "table", name: "EMPLOYEES" },
    fields: [{ apiField: "id", apiType: "integer", dbColumn: "EMPLOYEE_ID", oracleType: "number" }],
    operations: [{ operation: "list", enabled: true }],
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees:v1", schemaVersion: "1" },
    ...overrides
  };
}

function fakeSnapshot(connectionId = "conn-1"): StoredOracleSchemaSnapshot {
  const snap: OracleSchemaSnapshot = {
    connectionId,
    owner: "HR",
    inspectedAt: NOW.toISOString(),
    objects: [],
    sequences: [],
    programUnits: []
  };
  return {
    id: "snap-1",
    apiConnectionId: connectionId,
    oracleOwner: "HR",
    snapshotData: snap,
    capturedAt: NOW,
    capturedBy: null
  };
}

// ─── Minimal mock context builder ─────────────────────────────────────────────

function makeCtx(overrides: Partial<BridgeHttpContext> = {}): BridgeHttpContext {
  return {
    connections: {
      createConnection:     vi.fn().mockResolvedValue(safeConnection()),
      listConnections:      vi.fn().mockResolvedValue([safeConnection()]),
      getConnectionSafe:    vi.fn().mockResolvedValue(safeConnection()),
      updateConnection:     vi.fn().mockResolvedValue(safeConnection()),
      markConnectionStatus: vi.fn().mockResolvedValue(safeConnection())
    },
    inspector: {
      inspectOracleSchema: vi.fn().mockResolvedValue({
        snapshot: fakeSnapshot().snapshotData,
        storedSnapshot: fakeSnapshot()
      })
    },
    capabilityDetector: {
      detectOracleCapabilities: vi.fn().mockResolvedValue({
        versionString: "Oracle Database 19c",
        majorVersion: 19,
        paginationStrategy: "offsetFetch"
      })
    },
    drafts: {
      createDraftContract:  vi.fn().mockResolvedValue(storedDraft()),
      getDraftContract:     vi.fn().mockResolvedValue(storedDraft()),
      updateDraftContract:  vi.fn().mockResolvedValue(storedDraft()),
      listDraftContracts:   vi.fn().mockResolvedValue([storedDraft()]),
      archiveDraftContract: vi.fn().mockResolvedValue({ ...storedDraft(), status: "archived" }),
      getPublishedContractByEndpoint: vi.fn().mockResolvedValue(null)
    },
    publisher: {
      publishDraftContract: vi.fn().mockResolvedValue({
        publishedContract: storedPublished(),
        versionRecord: {},
        historyRecord: {},
        deprecatedPrevious: []
      })
    },
    compiler: {
      compile: vi.fn().mockResolvedValue({
        contract: resolvedContract(),
        diagnostics: [{ code: "CONTRACT_COMPILED", message: "OK", severity: "info" }]
      })
    },
    cache: {
      loadActiveContracts:  vi.fn().mockResolvedValue(undefined),
      getContractByEndpoint: vi.fn().mockReturnValue(undefined),
      reloadContract:       vi.fn().mockResolvedValue(undefined),
      reloadAllContracts:   vi.fn().mockResolvedValue(undefined)
    },
    adapter: {} as any,
    permissions: { check: () => true },
    oracleBindTypes: {
      string: "string", number: "number", date: "date",
      timestamp: "timestamp", cursor: "cursor", buffer: "buffer", clob: "clob", blob: "blob"
    },
    store: {
      oracleSchemaSnapshot: {
        findMany:  vi.fn().mockResolvedValue([fakeSnapshot()]),
        findUnique: vi.fn().mockResolvedValue(fakeSnapshot())
      },
      publishedContract: {
        findMany:  vi.fn().mockResolvedValue([storedPublished()]),
        findUnique: vi.fn().mockResolvedValue(storedPublished())
      },
      compilerDiagnostic: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog:           { findMany: vi.fn().mockResolvedValue([]) }
    },
    ...overrides
  } as BridgeHttpContext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Admin flows", () => {
  // Test 1
  it("1. POST /bridge/connections creates a connection", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.createConnection({
      name: "Test DB",
      connectionType: "serviceName",
      host: "db.example.com",
      port: 1521,
      serviceName: "ORCL",
      username: "HR"
    });
    expect(result.status).toBe(201);
    expect((result.body as any).data.id).toBe("conn-1");
    expect(ctx.connections.createConnection).toHaveBeenCalledOnce();
  });

  it("1b. POST /bridge/connections rejects a missing body with details", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.createConnection(undefined);

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Request body must be a JSON object.",
        details: [
          {
            field: "body",
            message: "Send a JSON object with name, connectionType, and username."
          }
        ]
      }
    });
    expect(ctx.connections.createConnection).not.toHaveBeenCalled();
  });

  // Test 2
  it("2. GET /bridge/connections returns a list of connections", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.listConnections();
    expect(result.status).toBe(200);
    const data = (result.body as any).data as OracleConnectionSafe[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("conn-1");
  });

  // Test 3
  it("3. POST /bridge/connections/:id/inspect triggers schema inspection", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.inspectSchema("conn-1", { owner: "HR" });
    expect(result.status).toBe(201);
    const snap = (result.body as any).data as StoredOracleSchemaSnapshot;
    expect(snap.apiConnectionId).toBe("conn-1");
    expect(snap.oracleOwner).toBe("HR");
    expect(ctx.inspector.inspectOracleSchema).toHaveBeenCalledWith("conn-1", "HR");
  });

  // Test 4
  it("4. POST /bridge/contracts/drafts creates a draft", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.createDraft({
      apiConnectionId: "conn-1",
      contract: storedDraft().draftData
    });
    expect(result.status).toBe(201);
    const draft = (result.body as any).data as StoredDraftContract;
    expect(draft.id).toBe("draft-1");
    expect(draft.resourceName).toBe("employees");
    expect(ctx.drafts.createDraftContract).toHaveBeenCalledOnce();
  });

  // Test 5
  it("5. GET /bridge/contracts/drafts/:id returns the draft", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.getDraft("draft-1");
    expect(result.status).toBe(200);
    const draft = (result.body as any).data as StoredDraftContract;
    expect(draft.id).toBe("draft-1");
    expect(ctx.drafts.getDraftContract).toHaveBeenCalledWith("draft-1");
  });

  // Test 6
  it("6. POST /bridge/contracts/drafts/:id/archive archives the draft", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.archiveDraft("draft-1");
    expect(result.status).toBe(200);
    const draft = (result.body as any).data as StoredDraftContract;
    expect(draft.status).toBe("archived");
    expect(ctx.drafts.archiveDraftContract).toHaveBeenCalledWith("draft-1");
  });

  // Test 7
  it("7. POST /bridge/compiler/validate returns diagnostics and valid flag", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.validateDraft({
      apiConnectionId: "conn-1",
      contract: storedDraft().draftData
    });
    expect(result.status).toBe(200);
    const body = result.body as any;
    expect(body.valid).toBe(true);
    expect(Array.isArray(body.diagnostics)).toBe(true);
    expect(ctx.compiler.compile).toHaveBeenCalledOnce();
  });

  // Test 8
  it("8. POST /bridge/contracts/drafts/:id/publish publishes and returns the published contract", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.publishDraft("draft-1", { publishedBy: "admin" });
    expect(result.status).toBe(201);
    const pub = (result.body as any).data as StoredPublishedContract;
    expect(pub.id).toBe("pub-1");
    expect(pub.status).toBe("active");
    expect(ctx.publisher.publishDraftContract).toHaveBeenCalledWith("draft-1", "admin", undefined);
  });

  // Test 9
  it("9. GET /bridge/contracts/published returns active published contracts", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.listPublished();
    expect(result.status).toBe(200);
    const contracts = (result.body as any).data as StoredPublishedContract[];
    expect(Array.isArray(contracts)).toBe(true);
    expect(contracts[0].status).toBe("active");
    expect(ctx.store.publishedContract.findMany).toHaveBeenCalledWith({ where: { status: "active" } });
  });

  // Test 10
  it("10. POST /bridge/cache/reload triggers cache reload", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.reloadCache();
    expect(result.status).toBe(200);
    expect((result.body as any).success).toBe(true);
    expect(ctx.cache.reloadAllContracts).toHaveBeenCalledOnce();
  });

  // Test 11
  it("11. Draft-only endpoint is not invokable via runtime (returns 404)", async () => {
    // Cache has no entries — no published contract for this endpoint
    const ctx = makeCtx({
      cache: {
        loadActiveContracts: vi.fn(),
        getContractByEndpoint: vi.fn().mockReturnValue(undefined), // nothing published
        reloadContract: vi.fn(),
        reloadAllContracts: vi.fn()
      }
    });
    const dispatch = createRuntimeDispatcher(ctx);
    const result = await dispatch({ method: "GET", contractPath: "/api/hr/employees" });
    expect(result.status).toBe(404);
    expect((result.body as any).error).toMatch(/no contract/i);
  });

  // Test 12
  it("12. Runtime dispatches to handler for a published contract without querying the DB", async () => {
    const contract = resolvedContract();
    // Store query methods are NOT mocked to resolve — any call to them would reject,
    // proving the runtime path does not touch the store.
    const storeQuerySpy = vi.fn().mockRejectedValue(new Error("DB should not be queried per request"));

    const ctx = makeCtx({
      cache: {
        loadActiveContracts: vi.fn(),
        getContractByEndpoint: vi.fn().mockReturnValue(contract),
        reloadContract: vi.fn(),
        reloadAllContracts: vi.fn()
      },
      store: {
        oracleSchemaSnapshot: { findMany: storeQuerySpy, findUnique: storeQuerySpy },
        publishedContract:    { findMany: storeQuerySpy, findUnique: storeQuerySpy },
        compilerDiagnostic:   { findMany: storeQuerySpy },
        auditLog:             { findMany: storeQuerySpy }
      },
      adapter: {
        query: vi.fn().mockResolvedValue({ rows: [{ EMPLOYEE_ID: 1 }], metaData: [] }),
        openConnection: vi.fn(),
        closeConnection: vi.fn(),
        execute: vi.fn()
      } as any
    });

    const dispatch = createRuntimeDispatcher(ctx);
    const result = await dispatch({ method: "GET", contractPath: "/api/hr/employees" });

    // Handler ran (not 404, not an error from the store spy)
    expect(result.status).not.toBe(404);
    expect(storeQuerySpy).not.toHaveBeenCalled();
  });
});
