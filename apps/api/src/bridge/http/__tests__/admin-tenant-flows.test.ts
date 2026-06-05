import { describe, expect, it } from "vitest";
import { createAdminHandlers } from "../admin-handlers.js";
import type { BridgeHttpContext } from "../context.js";
import type { TenantService, StoredBridgeTenant, StoredBridgeTenantConnection, StoredBridgeUserTenantAccess } from "../../tenants/index.js";
import { HttpError } from "../../../error-handler.js";

const NOW = new Date("2026-06-04T00:00:00.000Z");

function storedTenant(overrides: Partial<StoredBridgeTenant> = {}): StoredBridgeTenant {
  return {
    id: "tenant-1",
    code: "tenant_pssbsa",
    name: "PSSBSA",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function storedTenantConnection(overrides: Partial<StoredBridgeTenantConnection> = {}): StoredBridgeTenantConnection {
  return {
    id: "conn-assoc-1",
    tenantId: "tenant-1",
    apiConnectionId: "api-conn-uuid-1",
    alias: "legacy-erp",
    isDefault: true,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function storedUserAccess(overrides: Partial<StoredBridgeUserTenantAccess> = {}): StoredBridgeUserTenantAccess {
  return {
    id: "access-1",
    userId: "ajaykk",
    tenantId: "tenant-1",
    role: "bridge.admin",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeTenantService(overrides: Partial<TenantService> = {}): TenantService {
  return {
    createTenant: async () => storedTenant(),
    listTenants: async () => [storedTenant()],
    getTenant: async (id) => id === "tenant-1" ? storedTenant() : null,
    assignConnectionToTenant: async () => storedTenantConnection(),
    listTenantConnections: async () => [storedTenantConnection()],
    assignUserToTenant: async () => storedUserAccess(),
    listUserTenantAccess: async () => [storedUserAccess()],
    verifyUserTenantAccess: async () => true,
    resolveDefaultConnectionForTenant: async () => "api-conn-uuid-1",
    ...overrides
  };
}

function minimalCtx(tenants?: TenantService): Pick<BridgeHttpContext, "tenants"> & Partial<BridgeHttpContext> {
  return { tenants } as any;
}

function makeCtx(tenants?: TenantService): BridgeHttpContext {
  return minimalCtx(tenants) as BridgeHttpContext;
}

describe("Admin tenant handlers — createTenant", () => {
  it("creates a tenant and returns 201", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.createTenant({ code: "tenant_pssbsa", name: "PSSBSA" });

    expect(result.status).toBe(201);
    expect((result.body as any).data.code).toBe("tenant_pssbsa");
  });

  it("returns 400 when code is missing", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.createTenant({ name: "PSSBSA" });

    expect(result.status).toBe(400);
    expect((result.body as any).error).toMatch(/code/);
  });

  it("returns 400 when name is missing", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.createTenant({ code: "t1" });

    expect(result.status).toBe(400);
    expect((result.body as any).error).toMatch(/name/);
  });

  it("returns 501 when tenant service is not configured", async () => {
    const h = createAdminHandlers(makeCtx(undefined));
    const result = await h.createTenant({ code: "t1", name: "T1" });

    expect(result.status).toBe(501);
  });

  it("propagates 409 from service for duplicate code", async () => {
    const svc = makeTenantService({
      createTenant: async () => {
        throw new HttpError(409, "DUPLICATE_TENANT_CODE", "Tenant with code 't1' already exists.");
      }
    });
    const h = createAdminHandlers(makeCtx(svc));

    // HttpError is thrown and caught by the router's next(error); handlers themselves don't catch it.
    await expect(h.createTenant({ code: "t1", name: "T1" }))
      .rejects.toBeInstanceOf(HttpError);
  });
});

describe("Admin tenant handlers — listTenants", () => {
  it("lists tenants and returns 200", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.listTenants();

    expect(result.status).toBe(200);
    expect(Array.isArray((result.body as any).data)).toBe(true);
    expect((result.body as any).data).toHaveLength(1);
  });
});

describe("Admin tenant handlers — getTenant", () => {
  it("returns a tenant by id with 200", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.getTenant("tenant-1");

    expect(result.status).toBe(200);
    expect((result.body as any).data.id).toBe("tenant-1");
  });

  it("returns 404 for unknown tenant", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.getTenant("no-such-id");

    expect(result.status).toBe(404);
    expect((result.body as any).error).toMatch(/not found/i);
  });
});

describe("Admin tenant handlers — assignTenantConnection", () => {
  it("assigns a connection and returns 201", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.assignTenantConnection("tenant-1", {
      apiConnectionId: "api-conn-uuid-1",
      alias: "legacy-erp",
      isDefault: true
    });

    expect(result.status).toBe(201);
    expect((result.body as any).data.apiConnectionId).toBe("api-conn-uuid-1");
  });

  it("returns 400 when apiConnectionId is missing", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.assignTenantConnection("tenant-1", {});

    expect(result.status).toBe(400);
    expect((result.body as any).error).toMatch(/apiConnectionId/);
  });

  it("returns 501 when tenant service not configured", async () => {
    const h = createAdminHandlers(makeCtx(undefined));
    const result = await h.assignTenantConnection("tenant-1", { apiConnectionId: "c1" });

    expect(result.status).toBe(501);
  });

  it("propagates 404 from service for unknown tenant", async () => {
    const svc = makeTenantService({
      assignConnectionToTenant: async () => {
        throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant not found.");
      }
    });
    const h = createAdminHandlers(makeCtx(svc));

    await expect(h.assignTenantConnection("bad-id", { apiConnectionId: "c1" }))
      .rejects.toBeInstanceOf(HttpError);
  });
});

describe("Admin tenant handlers — listTenantConnections", () => {
  it("returns connections for tenant with 200", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.listTenantConnections("tenant-1");

    expect(result.status).toBe(200);
    expect((result.body as any).data).toHaveLength(1);
  });
});

describe("Admin tenant handlers — assignTenantUser", () => {
  it("assigns a user and returns 201", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.assignTenantUser("tenant-1", { userId: "ajaykk", role: "bridge.admin" });

    expect(result.status).toBe(201);
    expect((result.body as any).data.userId).toBe("ajaykk");
  });

  it("returns 400 when userId is missing", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.assignTenantUser("tenant-1", { role: "bridge.admin" });

    expect(result.status).toBe(400);
    expect((result.body as any).error).toMatch(/userId/);
  });

  it("returns 400 when role is missing", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.assignTenantUser("tenant-1", { userId: "ajaykk" });

    expect(result.status).toBe(400);
    expect((result.body as any).error).toMatch(/role/);
  });

  it("returns 501 when tenant service not configured", async () => {
    const h = createAdminHandlers(makeCtx(undefined));
    const result = await h.assignTenantUser("tenant-1", { userId: "u1", role: "r1" });

    expect(result.status).toBe(501);
  });
});

describe("Admin tenant handlers — listTenantUsers", () => {
  it("returns users for tenant with 200", async () => {
    const h = createAdminHandlers(makeCtx(makeTenantService()));
    const result = await h.listTenantUsers("tenant-1");

    expect(result.status).toBe(200);
    expect((result.body as any).data).toHaveLength(1);
    expect((result.body as any).data[0].userId).toBe("ajaykk");
  });
});
