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
    tenantId: null,
    apiConnectionId: null,
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
    contentHash: null,
    capturedAt: NOW,
    capturedBy: null
  };
}

function driftReadySnapshot(): StoredOracleSchemaSnapshot {
  const snapshot = richSnapshot();
  snapshot.snapshotData.objects = [
    {
      owner: "HR",
      objectName: "EMPLOYEES",
      objectType: "TABLE",
      objectStatus: "VALID",
      columns: [
        {
          name: "EMPLOYEE_ID",
          oracleType: "NUMBER",
          nullable: false,
          dataLength: 22,
          precision: 10,
          scale: 0,
          charLength: null,
          dataDefault: null
        }
      ],
      constraints: [],
      indexes: []
    }
  ];
  return snapshot;
}

function richSnapshot(id = "snap-1", contentHash = "hash-1"): StoredOracleSchemaSnapshot {
  const snap: OracleSchemaSnapshot = {
    connectionId: "conn-1",
    owner: "HR",
    inspectedAt: NOW.toISOString(),
    objects: [
      {
        owner: "HR",
        objectName: "EMPLOYEES",
        objectType: "TABLE",
        objectStatus: "VALID",
        columns: [
          {
            name: "EMPLOYEE_ID",
            oracleType: "NUMBER",
            nullable: false,
            dataLength: null,
            precision: 10,
            scale: 0,
            charLength: null,
            dataDefault: null
          }
        ],
        constraints: [
          {
            name: "EMP_PK",
            type: "PRIMARY_KEY",
            columns: ["EMPLOYEE_ID"],
            searchCondition: null,
            referencedOwner: null,
            referencedObjectName: null,
            referencedConstraintName: null
          }
        ],
        indexes: [
          { name: "EMP_PK", unique: true, columns: ["EMPLOYEE_ID"] }
        ]
      },
      {
        owner: "HR",
        objectName: "DEPARTMENTS",
        objectType: "TABLE",
        objectStatus: "VALID",
        columns: [],
        constraints: [],
        indexes: []
      }
    ],
    sequences: [
      { owner: "HR", name: "EMP_SEQ" }
    ],
    programUnits: [
      {
        owner: "HR",
        packageName: "PKG_EMP",
        name: "LIST_EMPLOYEES",
        unitType: "PACKAGE_PROCEDURE",
        objectStatus: "VALID",
        arguments: [
          {
            name: "P_RESULT",
            position: 1,
            direction: "OUT",
            oracleType: "SYS_REFCURSOR",
            isSysRefCursor: true
          }
        ],
        returnType: null
      },
      {
        owner: "HR",
        packageName: null,
        name: "PING",
        unitType: "FUNCTION",
        objectStatus: "VALID",
        arguments: [],
        returnType: "VARCHAR2"
      }
    ]
  };

  return {
    id,
    apiConnectionId: "conn-1",
    oracleOwner: "HR",
    snapshotData: snap,
    contentHash,
    capturedAt: NOW,
    capturedBy: "tester"
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
      getContractByScopedEndpoint: vi.fn().mockReturnValue(undefined),
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
        findUnique: vi.fn().mockResolvedValue(fakeSnapshot()),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      publishedContract: {
        findMany:  vi.fn().mockResolvedValue([storedPublished()]),
        findUnique: vi.fn().mockResolvedValue(storedPublished()),
        update: vi.fn().mockImplementation(async ({ data }) => ({ ...storedPublished(), ...data }))
      },
      contractPublishHistory: { create: vi.fn().mockResolvedValue({ id: "hist-1" }) },
      schemaDriftReport: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: "drift-1",
          publishedContractId: data.publishedContractId,
          severity: data.severity,
          status: data.status,
          reportData: data.reportData,
          checkedAt: NOW,
          resolvedAt: null
        }))
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
    const tenantId = "11111111-1111-1111-1111-111111111111";
    const apiConnectionId = "22222222-2222-2222-2222-222222222222";
    const result = await h.publishDraft("draft-1", { publishedBy: "admin", tenantId, apiConnectionId });
    expect(result.status).toBe(201);
    const pub = (result.body as any).data as StoredPublishedContract;
    expect(pub.id).toBe("pub-1");
    expect(pub.status).toBe("active");
    expect(ctx.publisher.publishDraftContract).toHaveBeenCalledWith("draft-1", "admin", tenantId, undefined);
  });

  it("8a. POST /bridge/contracts/drafts/:id/publish returns 400 when tenantId is missing", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.publishDraft("draft-1", {
      publishedBy: "admin",
      apiConnectionId: "22222222-2222-2222-2222-222222222222"
    });
    expect(result.status).toBe(400);
    expect((result.body as any).error).toMatch(/tenantId/);
    expect(ctx.publisher.publishDraftContract).not.toHaveBeenCalled();
  });

  it("8b. POST /bridge/contracts/drafts/:id/publish returns 400 when apiConnectionId is missing", async () => {
    const ctx = makeCtx();
    const h = createAdminHandlers(ctx);
    const result = await h.publishDraft("draft-1", {
      publishedBy: "admin",
      tenantId: "11111111-1111-1111-1111-111111111111"
    });
    expect(result.status).toBe(400);
    expect((result.body as any).error).toMatch(/apiConnectionId/);
    expect(ctx.publisher.publishDraftContract).not.toHaveBeenCalled();
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
        getContractByScopedEndpoint: vi.fn().mockReturnValue(undefined),
        reloadContract: vi.fn(),
        reloadAllContracts: vi.fn()
      }
    });
    const dispatch = createRuntimeDispatcher(ctx);
    const result = await dispatch({ method: "GET", contractPath: "/api/hr/employees", tenantId: "t1", apiConnectionId: "c1" });
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
        getContractByEndpoint: vi.fn().mockReturnValue(undefined),
        getContractByScopedEndpoint: vi.fn().mockReturnValue({ contract, publishedContractId: "pub-1" }),
        reloadContract: vi.fn(),
        reloadAllContracts: vi.fn()
      },
      store: {
        oracleSchemaSnapshot: { findMany: storeQuerySpy, findUnique: storeQuerySpy, findFirst: storeQuerySpy },
        publishedContract:    { findMany: storeQuerySpy, findUnique: storeQuerySpy, update: storeQuerySpy },
        contractPublishHistory: { create: storeQuerySpy },
        schemaDriftReport: { create: storeQuerySpy },
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
    const result = await dispatch({ method: "GET", contractPath: "/api/hr/employees", tenantId: "t1", apiConnectionId: "c1" });

    // Handler ran (not 404, not an error from the store spy)
    expect(result.status).not.toBe(404);
    expect(storeQuerySpy).not.toHaveBeenCalled();
  });

  it("13. inspectSchema marks the first snapshot as changed with no previous snapshot.", async () => {
    const storedSnapshot = richSnapshot("snap-first", "hash-1");
    const ctx = makeCtx({
      inspector: {
        inspectOracleSchema: vi.fn().mockResolvedValue({
          snapshot: storedSnapshot.snapshotData,
          storedSnapshot
        })
      },
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          ...makeCtx().store.oracleSchemaSnapshot,
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    });
    const result = await createAdminHandlers(ctx).inspectSchema("conn-1", { owner: "hr" });

    expect(result.status).toBe(201);
    expect(result.headers?.Location).toBe("/bridge/schema-snapshots/snap-first");
    expect((result.body as any).data).toMatchObject({
      id: "snap-first",
      changed: true,
      previousSnapshotId: null,
      summary: { objects: 2, sequences: 1, programUnits: 2 }
    });
    expect(JSON.stringify(result.body)).not.toContain("snapshotData");
  });

  it("14. inspectSchema marks same contentHash as unchanged with previousSnapshotId.", async () => {
    const storedSnapshot = richSnapshot("snap-new", "hash-1");
    const previousSnapshot = richSnapshot("snap-old", "hash-1");
    const ctx = makeCtx({
      inspector: {
        inspectOracleSchema: vi.fn().mockResolvedValue({
          snapshot: storedSnapshot.snapshotData,
          storedSnapshot
        })
      },
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          ...makeCtx().store.oracleSchemaSnapshot,
          findFirst: vi.fn().mockResolvedValue(previousSnapshot)
        }
      }
    });
    const result = await createAdminHandlers(ctx).inspectSchema("conn-1", { owner: "HR" });

    expect(result.status).toBe(201);
    expect((result.body as any).data.changed).toBe(false);
    expect((result.body as any).data.previousSnapshotId).toBe("snap-old");
  });

  it("15. inspectSchema marks different contentHash as changed with previousSnapshotId.", async () => {
    const storedSnapshot = richSnapshot("snap-new", "hash-2");
    const previousSnapshot = richSnapshot("snap-old", "hash-1");
    const ctx = makeCtx({
      inspector: {
        inspectOracleSchema: vi.fn().mockResolvedValue({
          snapshot: storedSnapshot.snapshotData,
          storedSnapshot
        })
      },
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          ...makeCtx().store.oracleSchemaSnapshot,
          findFirst: vi.fn().mockResolvedValue(previousSnapshot)
        }
      }
    });
    const result = await createAdminHandlers(ctx).inspectSchema("conn-1", { owner: "HR" });

    expect(result.status).toBe(201);
    expect((result.body as any).data.changed).toBe(true);
    expect((result.body as any).data.previousSnapshotId).toBe("snap-old");
  });

  it("16. snapshot list and summary endpoints return slim data only.", async () => {
    const snapshot = richSnapshot();
    const ctx = makeCtx({
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          findMany: vi.fn().mockResolvedValue([snapshot]),
          findUnique: vi.fn().mockResolvedValue(snapshot),
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    });
    const h = createAdminHandlers(ctx);

    const list = await h.listSnapshots();
    const summary = await h.getSnapshot("snap-1");
    const objects = await h.listSnapshotObjects("snap-1");
    const programUnits = await h.listSnapshotProgramUnits("snap-1");

    expect(list.status).toBe(200);
    expect(summary.status).toBe(200);
    expect(objects.status).toBe(200);
    expect(programUnits.status).toBe(200);
    expect((list.body as any).data[0]).toMatchObject({ id: "snap-1", summary: { objects: 2 } });
    expect((summary.body as any).data).toMatchObject({ id: "snap-1", summary: { programUnits: 2 } });
    expect((objects.body as any).data[0]).toEqual({
      owner: "HR",
      objectName: "EMPLOYEES",
      objectType: "TABLE",
      objectStatus: "VALID",
      columnCount: 1,
      constraintCount: 1,
      indexCount: 1
    });
    expect((programUnits.body as any).data[0]).toEqual({
      owner: "HR",
      packageName: "PKG_EMP",
      name: "LIST_EMPLOYEES",
      unitType: "PACKAGE_PROCEDURE",
      objectStatus: "VALID",
      argumentCount: 1,
      returnType: null
    });
    expect(JSON.stringify([list.body, summary.body, objects.body, programUnits.body])).not.toContain("snapshotData");
    expect(JSON.stringify(objects.body)).not.toContain("columns");
    expect(JSON.stringify(programUnits.body)).not.toContain("arguments");
  });

  it("17. snapshot detail endpoints return only the selected object or program unit.", async () => {
    const snapshot = richSnapshot();
    const ctx = makeCtx({
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          findMany: vi.fn().mockResolvedValue([snapshot]),
          findUnique: vi.fn().mockResolvedValue(snapshot),
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    });
    const h = createAdminHandlers(ctx);

    const objectResult = await h.getSnapshotObject("snap-1", "employees");
    const programUnitResult = await h.getSnapshotProgramUnit("snap-1", "LIST_EMPLOYEES", "PKG_EMP");
    const functionResult = await h.getSnapshotProgramUnit("snap-1", "PING");

    expect(objectResult.status).toBe(200);
    expect((objectResult.body as any).data.objectName).toBe("EMPLOYEES");
    expect((objectResult.body as any).data.columns).toHaveLength(1);
    expect(JSON.stringify(objectResult.body)).not.toContain("DEPARTMENTS");
    expect(programUnitResult.status).toBe(200);
    expect((programUnitResult.body as any).data.name).toBe("LIST_EMPLOYEES");
    expect((programUnitResult.body as any).data.arguments).toHaveLength(1);
    expect(JSON.stringify(programUnitResult.body)).not.toContain("\"PING\"");
    expect(functionResult.status).toBe(200);
    expect((functionResult.body as any).data.name).toBe("PING");
  });

  it("18. snapshot sequences endpoint returns sequence summaries and no raw snapshotData.", async () => {
    const snapshot = richSnapshot();
    const ctx = makeCtx({
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          findMany: vi.fn().mockResolvedValue([snapshot]),
          findUnique: vi.fn().mockResolvedValue(snapshot),
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    });
    const result = await createAdminHandlers(ctx).listSnapshotSequences("snap-1");

    expect(result.status).toBe(200);
    expect((result.body as any).data).toEqual([{ owner: "HR", name: "EMP_SEQ" }]);
    expect(JSON.stringify(result.body)).not.toContain("snapshotData");
  });

  it("19. snapshot drill-down endpoints return 404 for missing snapshots and entries.", async () => {
    const snapshot = richSnapshot();
    const missingSnapshotCtx = makeCtx({
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    });
    const missingEntryCtx = makeCtx({
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          findMany: vi.fn().mockResolvedValue([snapshot]),
          findUnique: vi.fn().mockResolvedValue(snapshot),
          findFirst: vi.fn().mockResolvedValue(null)
        }
      }
    });

    const missingSnapshot = await createAdminHandlers(missingSnapshotCtx).getSnapshotObject("missing", "EMPLOYEES");
    const missingObject = await createAdminHandlers(missingEntryCtx).getSnapshotObject("snap-1", "JOBS");
    const missingUnit = await createAdminHandlers(missingEntryCtx).getSnapshotProgramUnit("snap-1", "NOPE");

    expect(missingSnapshot.status).toBe(404);
    expect(missingObject.status).toBe(404);
    expect(missingUnit.status).toBe(404);
  });

  it("20. POST /bridge/contracts/published/:id/check-drift persists and returns a healthy report.", async () => {
    const ctx = makeCtx({
      store: {
        ...makeCtx().store,
        oracleSchemaSnapshot: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(driftReadySnapshot())
        }
      }
    });
    const result = await createAdminHandlers(ctx).checkPublishedDrift("pub-1");

    expect(result.status).toBe(200);
    expect((result.body as any).data).toMatchObject({
      id: "drift-1",
      publishedContractId: "pub-1",
      status: "healthy",
      severity: "healthy",
      findings: []
    });
    expect(ctx.store.schemaDriftReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        publishedContractId: "pub-1",
        severity: "healthy",
        status: "open"
      })
    });
  });

  it("21. POST /bridge/contracts/published/:id/check-drift returns 404 for a missing contract.", async () => {
    const ctx = makeCtx({
      store: {
        ...makeCtx().store,
        publishedContract: {
          ...makeCtx().store.publishedContract,
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    });

    const result = await createAdminHandlers(ctx).checkPublishedDrift("missing");

    expect(result.status).toBe(404);
    expect(ctx.store.schemaDriftReport.create).not.toHaveBeenCalled();
  });

  it("22. POST /bridge/contracts/published/:id/check-drift returns drifted findings without raw snapshot data.", async () => {
    const snapshot = driftReadySnapshot();
    snapshot.snapshotData.objects[0].columns[0].precision = 8;
    const contract = storedPublished();
    contract.contractData = resolvedContract({
      fields: [
        {
          apiField: "id",
          apiType: "integer",
          dbColumn: "EMPLOYEE_ID",
          oracleType: "number",
          columnHints: { precision: 10 }
        }
      ]
    });
    const ctx = makeCtx({
      store: {
        ...makeCtx().store,
        publishedContract: {
          ...makeCtx().store.publishedContract,
          findUnique: vi.fn().mockResolvedValue(contract)
        },
        oracleSchemaSnapshot: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(snapshot)
        }
      }
    });

    const result = await createAdminHandlers(ctx).checkPublishedDrift("pub-1");

    expect(result.status).toBe(200);
    expect((result.body as any).data.status).toBe("drifted");
    expect((result.body as any).data.findings[0]).toMatchObject({ severity: "drifted", category: "column" });
    expect(JSON.stringify(result.body)).not.toContain("snapshotData");
  });

  it("23. POST /bridge/contracts/published/:id/retire retires, audits, writes history, and reloads cache.", async () => {
    const audit = { log: vi.fn() };
    const ctx = makeCtx({ audit });
    const result = await createAdminHandlers(ctx).retirePublished("pub-1", {
      retiredBy: "admin",
      notes: "no longer used"
    });

    expect(result.status).toBe(200);
    expect((result.body as any).data).toEqual({
      id: "pub-1",
      resourceName: "employees",
      version: 1,
      endpointPath: "/api/hr/employees",
      status: "retired"
    });
    expect(ctx.store.publishedContract.update).toHaveBeenCalledWith({
      where: { id: "pub-1" },
      data: { status: "retired" }
    });
    expect(ctx.store.contractPublishHistory.create).toHaveBeenCalledWith({
      data: {
        publishedContractId: "pub-1",
        action: "retired",
        actor: "admin",
        notes: "no longer used"
      }
    });
    expect(ctx.cache.reloadContract).toHaveBeenCalledWith("pub-1");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      type: "contract.retired",
      actor: "admin"
    }));
  });

  it("24. POST /bridge/contracts/published/:id/retire returns 404 for a missing contract.", async () => {
    const ctx = makeCtx({
      store: {
        ...makeCtx().store,
        publishedContract: {
          ...makeCtx().store.publishedContract,
          findUnique: vi.fn().mockResolvedValue(null)
        }
      }
    });
    const result = await createAdminHandlers(ctx).retirePublished("missing", {});

    expect(result.status).toBe(404);
    expect(ctx.store.publishedContract.update).not.toHaveBeenCalled();
    expect(ctx.cache.reloadContract).not.toHaveBeenCalled();
  });

  it("25. POST /bridge/contracts/published/:id/retire is idempotent for already retired contracts.", async () => {
    const retired = { ...storedPublished(), status: "retired" };
    const ctx = makeCtx({
      store: {
        ...makeCtx().store,
        publishedContract: {
          ...makeCtx().store.publishedContract,
          findUnique: vi.fn().mockResolvedValue(retired)
        }
      }
    });
    const result = await createAdminHandlers(ctx).retirePublished("pub-1", { retiredBy: "admin" });

    expect(result.status).toBe(200);
    expect((result.body as any).data.status).toBe("retired");
    expect(ctx.store.publishedContract.update).not.toHaveBeenCalled();
    expect(ctx.store.contractPublishHistory.create).not.toHaveBeenCalled();
    expect(ctx.cache.reloadContract).toHaveBeenCalledWith("pub-1");
  });
});
