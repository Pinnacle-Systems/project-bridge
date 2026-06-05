import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { BridgeHttpContext } from "../bridge/http/index.js";
import type { ContractCache } from "../bridge/contracts/contract-cache.js";
import type { ResolvedApiContract } from "../bridge/contracts/index.js";
import type { OracleConnectorAdapter } from "../bridge/connections/oracle-adapter.js";
import type { CursorLike } from "../bridge/runtime/cursor-read-handler.js";
import type { PrincipalProvider } from "../bridge/auth/index.js";
import type { TenantResolver } from "../bridge/auth/tenant-resolution.js";
import { testOracleBindTypes } from "../bridge/runtime/oracle-helpers.js";

const NOW = new Date("2026-05-23T00:00:00.000Z");

const DEFAULT_TENANT = "tenant-a";
const DEFAULT_CONN = "conn-a";

function tableContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c-table",
    resource: "employees",
    version: 1,
    endpoint: "/employees",
    status: "active",
    publishedAt: NOW,
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees:v1", schemaVersion: "1" },
    source: { database: "db1", owner: "HR", type: "table", name: "EMPLOYEES" },
    fields: [
      { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID", readOnly: true },
      { apiField: "name", apiType: "string", oracleType: "varchar2", dbColumn: "FULL_NAME" }
    ],
    operations: [
      { operation: "list", enabled: true },
      { operation: "read", enabled: true }
    ],
    ...overrides
  };
}

function procedureContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return tableContract({
    id: "c-procedure",
    source: {
      database: "db1",
      owner: "HR",
      type: "package",
      packageName: "PKG_EMP",
      procedureName: "SAVE_EMP"
    },
    fields: [
      { apiField: "name", apiType: "string", oracleType: "varchar2" },
      { apiField: "id", apiType: "integer", oracleType: "number", readOnly: true }
    ],
    operations: [{ operation: "create", enabled: true }],
    procedureParams: [
      { paramName: "P_NAME", direction: "in", apiField: "name", oracleType: "varchar2", required: true },
      { paramName: "P_ID", direction: "out", apiField: "id", oracleType: "number" }
    ],
    ...overrides
  });
}

function directContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return tableContract({
    id: "c-direct",
    operations: [{ operation: "update", enabled: true, mode: "direct_table" }],
    ...overrides
  });
}

function cursorContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return procedureContract({
    id: "c-cursor",
    endpoint: "/cursor-employees",
    source: {
      database: "db1",
      owner: "HR",
      type: "package",
      packageName: "PKG_EMP",
      procedureName: "LIST_EMP"
    },
    operations: [{ operation: "list", enabled: true }],
    procedureParams: [{ paramName: "P_RESULT", direction: "out", oracleType: "sys_refcursor" }],
    sysRefCursor: {
      paramName: "P_RESULT",
      fields: [
        { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID" },
        { apiField: "name", apiType: "string", oracleType: "varchar2", dbColumn: "FULL_NAME" }
      ]
    },
    ...overrides
  });
}

function makeCursor(rows: Record<string, unknown>[]): CursorLike {
  let done = false;
  return {
    getRows: vi.fn(async () => {
      if (done) return [];
      done = true;
      return rows;
    }),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

/**
 * Scoped contract cache: returns contracts only for DEFAULT_TENANT + DEFAULT_CONN.
 * getContractByEndpoint always returns undefined — runtime must use scoped lookup.
 */
function makeCache(entries: Array<{ method: string; path: string; contract: ResolvedApiContract }>): ContractCache {
  return {
    getContractByEndpoint: vi.fn(() => undefined),
    getContractByScopedEndpoint: vi.fn(({ tenantId, apiConnectionId, method, endpointPath }) => {
      if (tenantId !== DEFAULT_TENANT || apiConnectionId !== DEFAULT_CONN) return undefined;
      const entry = entries.find(
        e => e.method === method.toUpperCase() && e.path === endpointPath
      );
      if (!entry) return undefined;
      return { contract: entry.contract, publishedContractId: "pub-1" };
    }),
    loadActiveContracts: vi.fn(),
    reloadContract: vi.fn(),
    reloadAllContracts: vi.fn()
  };
}

function makeAdapter(cursor = makeCursor([])): OracleConnectorAdapter {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }] }),
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 1, outBinds: { generatedId: 10 } }),
    executePlsqlBlock: vi.fn().mockResolvedValue({ rows: [], outBinds: { P_ID: 10, P_RESULT: cursor } }),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

/** Stub auth that grants access when x-bridge-user-id header is set. */
function makeAuth(): PrincipalProvider {
  return {
    resolvePrincipal(req) {
      const userId = req.get("x-bridge-user-id");
      if (!userId) return null;
      const tenantIds = (req.get("x-bridge-tenant-id") ?? "").split(",").map(s => s.trim()).filter(Boolean);
      return { userId, tenantIds, roles: [], permissions: [] };
    }
  };
}

/** Stub tenant resolver that grants access for DEFAULT_TENANT and resolves DEFAULT_CONN. */
function makeTenantResolver(): TenantResolver {
  return {
    async resolveTenant(principal, tenantId) {
      if (!principal) return { ok: false, error: { kind: "UNAUTHENTICATED" } };
      if (!principal.tenantIds.includes(tenantId)) {
        return { ok: false, error: { kind: "TENANT_NOT_IN_PRINCIPAL", tenantId } };
      }
      if (tenantId !== DEFAULT_TENANT) {
        return { ok: false, error: { kind: "TENANT_ACCESS_DENIED", tenantId } };
      }
      return { ok: true, context: { tenantId, apiConnectionId: DEFAULT_CONN } };
    }
  };
}

function makeCtx(cache: ContractCache, adapter: OracleConnectorAdapter): BridgeHttpContext {
  return {
    cache,
    adapter,
    permissions: { check: () => true },
    oracleBindTypes: testOracleBindTypes,
    auth: makeAuth(),
    tenantResolver: makeTenantResolver(),
    connections: {} as any,
    inspector: {} as any,
    capabilityDetector: {} as any,
    drafts: {} as any,
    publisher: {} as any,
    compiler: {} as any,
    store: {} as any
  };
}

/** Default auth headers for authenticated requests. */
const AUTH_HEADERS = {
  "x-bridge-user-id": "user-1",
  "x-bridge-tenant-id": DEFAULT_TENANT
};

async function request(
  ctx: BridgeHttpContext,
  method: string,
  path: string,
  options: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; body: unknown }> {
  const app = createApp(ctx, { adminApiKey: "test-key" });
  const payload = options.body ? JSON.stringify(options.body) : undefined;
  const req = new Readable({ read() {} }) as any;
  req.url = path;
  req.originalUrl = path;
  req.method = method;
  req.headers = {
    ...(payload
      ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload).toString() }
      : {}),
    ...(options.headers ?? AUTH_HEADERS)
  };
  const socket = new PassThrough() as any;
  socket.destroy = vi.fn();
  req.socket = socket;
  req.connection = socket;
  if (payload) {
    req.push(payload);
  }
  req.push(null);

  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const headers = new Map<string, string | number | readonly string[]>();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      }
    }) as any;
    res.statusCode = 200;
    res.setHeader = (name: string, value: string | number | readonly string[]) => {
      headers.set(name.toLowerCase(), value);
      return res;
    };
    res.getHeader = (name: string) => headers.get(name.toLowerCase());
    res.removeHeader = (name: string) => {
      headers.delete(name.toLowerCase());
    };
    res.end = (chunk?: unknown) => {
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({ status: res.statusCode, body: text ? JSON.parse(text) : undefined });
      return res;
    };
    (app as any).handle(req, res, reject);
  });
}

describe("production app runtime router", () => {
  it("dispatches GET list to the read handler.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "GET", path: "/employees", contract: tableContract() }]), adapter);

    const result = await request(ctx, "GET", "/api/employees");

    expect(result.status).toBe(200);
    expect(adapter.query).toHaveBeenCalledOnce();
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });

  it("dispatches POST package_procedure to the write handler.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "POST", path: "/employees", contract: procedureContract() }]), adapter);

    const result = await request(ctx, "POST", "/api/employees", { body: { name: "Alice" } });

    expect(result.status).toBe(201);
    expect(adapter.executePlsqlBlock).toHaveBeenCalledOnce();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("dispatches PATCH direct_table to the direct write handler.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "PATCH", path: "/employees", contract: directContract() }]), adapter);

    const result = await request(ctx, "PATCH", "/api/employees/1", { body: { name: "Alice" } });

    expect(result.status).toBe(200);
    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });

  it("dispatches GET SYS_REFCURSOR to the cursor handler.", async () => {
    const cursor = makeCursor([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }]);
    const adapter = makeAdapter(cursor);
    const ctx = makeCtx(makeCache([{ method: "GET", path: "/cursor-employees", contract: cursorContract() }]), adapter);

    const result = await request(ctx, "GET", "/api/cursor-employees");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: [{ id: 1, name: "Alice" }] });
    expect(adapter.executePlsqlBlock).toHaveBeenCalledOnce();
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("parses and forwards sort query params.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "GET", path: "/employees", contract: tableContract() }]), adapter);

    const result = await request(ctx, "GET", "/api/employees?sort[name]=desc");

    expect(result.status).toBe(200);
    expect(adapter.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY "FULL_NAME" DESC'),
      expect.anything(),
      expect.objectContaining({ outFormat: "object" })
    );
  });

  it("unknown runtime routes return 404.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([]), adapter);

    const result = await request(ctx, "GET", "/api/unknown");

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "No contract found for this endpoint." });
  });

  it("DELETE returns explicit unsupported response for MVP.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "DELETE", path: "/employees", contract: tableContract({
      operations: [{ operation: "delete", enabled: true }]
    }) }]), adapter);

    const result = await request(ctx, "DELETE", "/api/employees/1");

    expect(result.status).toBe(405);
    expect(result.body).toEqual({ error: "Method not allowed for this contract." });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("disabled operations return a safe response.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "POST", path: "/employees", contract: procedureContract({
      operations: [{ operation: "create", enabled: false }]
    }) }]), adapter);

    const result = await request(ctx, "POST", "/api/employees", { body: { name: "Alice" } });

    expect(result.status).toBe(405);
    expect(result.body).toEqual({ error: "Method not allowed for this contract." });
    expect(adapter.executePlsqlBlock).not.toHaveBeenCalled();
  });
});

describe("production app runtime router — auth enforcement", () => {
  it("request with no auth headers returns 401.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "GET", path: "/employees", contract: tableContract() }]), adapter);

    const result = await request(ctx, "GET", "/api/employees", { headers: {} });

    expect(result.status).toBe(401);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("request with user-id but no tenant-id header returns 401.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "GET", path: "/employees", contract: tableContract() }]), adapter);

    const result = await request(ctx, "GET", "/api/employees", {
      headers: { "x-bridge-user-id": "user-1" }
    });

    expect(result.status).toBe(401);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("authenticated request for a tenant the user does not belong to returns 403.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([{ method: "GET", path: "/employees", contract: tableContract() }]), adapter);

    const result = await request(ctx, "GET", "/api/employees", {
      headers: { "x-bridge-user-id": "user-1", "x-bridge-tenant-id": "tenant-other" }
    });

    expect(result.status).toBe(403);
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("authenticated request with valid tenant but no matching contract returns 404.", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(makeCache([]), adapter);

    const result = await request(ctx, "GET", "/api/employees");

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "No contract found for this endpoint." });
    expect(adapter.query).not.toHaveBeenCalled();
  });

  it("tenant A /employees resolves only tenant A contract.", async () => {
    const adapter = makeAdapter();
    const contractA = tableContract({ id: "contract-a" });
    const ctx = makeCtx(makeCache([{ method: "GET", path: "/employees", contract: contractA }]), adapter);

    const result = await request(ctx, "GET", "/api/employees");

    expect(result.status).toBe(200);
    expect(adapter.query).toHaveBeenCalledOnce();
  });

  it("runtime never calls getContractByEndpoint for /api/* dispatch.", async () => {
    const adapter = makeAdapter();
    const cache = makeCache([{ method: "GET", path: "/employees", contract: tableContract() }]);
    const ctx = makeCtx(cache, adapter);

    await request(ctx, "GET", "/api/employees");

    expect(cache.getContractByEndpoint).not.toHaveBeenCalled();
    expect(cache.getContractByScopedEndpoint).toHaveBeenCalled();
  });
});
