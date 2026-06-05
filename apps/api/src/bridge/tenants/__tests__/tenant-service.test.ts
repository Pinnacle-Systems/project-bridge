import { describe, expect, it } from "vitest";
import {
  createTenantService,
  type BridgeTenantStore,
  type StoredBridgeTenant,
  type StoredBridgeTenantConnection,
  type StoredBridgeUserTenantAccess
} from "../index.js";

const NOW = new Date("2026-06-04T00:00:00.000Z");

// ─── In-memory store ──────────────────────────────────────────────────────────

function createMemoryStore(): BridgeTenantStore & { _tenants: StoredBridgeTenant[]; _connections: StoredBridgeTenantConnection[]; _access: StoredBridgeUserTenantAccess[] } {
  const _tenants: StoredBridgeTenant[] = [];
  const _connections: StoredBridgeTenantConnection[] = [];
  const _access: StoredBridgeUserTenantAccess[] = [];
  let seq = 0;

  const nextId = () => `id-${++seq}`;

  return {
    _tenants,
    _connections,
    _access,

    bridgeTenant: {
      async create({ data }) {
        const record: StoredBridgeTenant = {
          id: data.id ?? nextId(),
          code: data.code,
          name: data.name,
          status: data.status,
          createdAt: NOW,
          updatedAt: NOW
        };
        _tenants.push(record);
        return record;
      },
      async update({ where, data }) {
        const record = _tenants.find(t => t.id === where.id);
        if (!record) throw new Error("Tenant not found");
        Object.assign(record, data, { updatedAt: new Date() });
        return record;
      },
      async findUnique({ where }) {
        if ("id" in where) return _tenants.find(t => t.id === where.id) ?? null;
        return _tenants.find(t => t.code === where.code) ?? null;
      },
      async findMany(args) {
        let results = [..._tenants];
        if (args?.where?.status) results = results.filter(t => t.status === args.where!.status);
        if (args?.orderBy?.code === "asc") results.sort((a, b) => a.code.localeCompare(b.code));
        return results;
      }
    },

    bridgeTenantConnection: {
      async create({ data }) {
        const record: StoredBridgeTenantConnection = {
          id: nextId(),
          tenantId: data.tenantId,
          apiConnectionId: data.apiConnectionId,
          alias: data.alias ?? null,
          isDefault: data.isDefault,
          status: data.status,
          createdAt: NOW,
          updatedAt: NOW
        };
        _connections.push(record);
        return record;
      },
      async update({ where, data }) {
        const record = _connections.find(c => c.id === where.id);
        if (!record) throw new Error("Connection not found");
        Object.assign(record, data, { updatedAt: new Date() });
        return record;
      },
      async findFirst(args) {
        const w = args?.where ?? {};
        return _connections.find(c => {
          if (w.tenantId !== undefined && c.tenantId !== w.tenantId) return false;
          if (w.apiConnectionId !== undefined && c.apiConnectionId !== w.apiConnectionId) return false;
          if (w.isDefault !== undefined && c.isDefault !== w.isDefault) return false;
          if (w.status !== undefined && c.status !== w.status) return false;
          return true;
        }) ?? null;
      },
      async findMany(args) {
        const w = args?.where ?? {};
        let results = _connections.filter(c => {
          if (w.tenantId !== undefined && c.tenantId !== w.tenantId) return false;
          if (w.status !== undefined && c.status !== w.status) return false;
          return true;
        });
        if (args?.orderBy?.createdAt === "asc") results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return results;
      }
    },

    bridgeUserTenantAccess: {
      async create({ data }) {
        const record: StoredBridgeUserTenantAccess = {
          id: nextId(),
          userId: data.userId,
          tenantId: data.tenantId,
          role: data.role,
          status: data.status,
          createdAt: NOW,
          updatedAt: NOW
        };
        _access.push(record);
        return record;
      },
      async findFirst(args) {
        const w = args?.where ?? {};
        return _access.find(a => {
          if (w.userId !== undefined && a.userId !== w.userId) return false;
          if (w.tenantId !== undefined && a.tenantId !== w.tenantId) return false;
          if (w.status !== undefined && a.status !== w.status) return false;
          return true;
        }) ?? null;
      },
      async findMany(args) {
        const w = args?.where ?? {};
        return _access.filter(a => {
          if (w.tenantId !== undefined && a.tenantId !== w.tenantId) return false;
          if (w.userId !== undefined && a.userId !== w.userId) return false;
          if (w.status !== undefined && a.status !== w.status) return false;
          return true;
        });
      }
    }
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TenantService — createTenant", () => {
  it("creates a tenant with trimmed code and name", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: " pssbsa ", name: " PSSBSA Corp " });

    expect(tenant.code).toBe("pssbsa");
    expect(tenant.name).toBe("PSSBSA Corp");
    expect(tenant.status).toBe("active");
    expect(tenant.id).toBeTruthy();
  });

  it("rejects duplicate tenant code", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    await svc.createTenant({ code: "pssbsa", name: "First" });

    await expect(svc.createTenant({ code: "pssbsa", name: "Second" }))
      .rejects.toMatchObject({ message: expect.stringContaining("already exists") });
  });

  it("rejects empty code", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    await expect(svc.createTenant({ code: "", name: "Name" }))
      .rejects.toMatchObject({ message: expect.stringContaining("code is required") });
  });

  it("rejects empty name", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    await expect(svc.createTenant({ code: "t1", name: "" }))
      .rejects.toMatchObject({ message: expect.stringContaining("name is required") });
  });
});

describe("TenantService — listTenants / getTenant", () => {
  it("lists all tenants ordered by code", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    await svc.createTenant({ code: "zzz", name: "ZZZ" });
    await svc.createTenant({ code: "aaa", name: "AAA" });

    const tenants = await svc.listTenants();
    expect(tenants[0].code).toBe("aaa");
    expect(tenants[1].code).toBe("zzz");
  });

  it("returns tenant by id", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const created = await svc.createTenant({ code: "t1", name: "T1" });
    const fetched = await svc.getTenant(created.id);

    expect(fetched?.id).toBe(created.id);
  });

  it("returns null for unknown id", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const result = await svc.getTenant("no-such-id");
    expect(result).toBeNull();
  });
});

describe("TenantService — assignConnectionToTenant", () => {
  it("assigns a connection to a tenant", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    const conn = await svc.assignConnectionToTenant(tenant.id, {
      apiConnectionId: "conn-uuid-1",
      isDefault: true
    });

    expect(conn.tenantId).toBe(tenant.id);
    expect(conn.apiConnectionId).toBe("conn-uuid-1");
    expect(conn.isDefault).toBe(true);
    expect(conn.status).toBe("active");
  });

  it("rejects assignment to unknown tenant", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    await expect(
      svc.assignConnectionToTenant("no-such-tenant", { apiConnectionId: "conn-1" })
    ).rejects.toMatchObject({ message: expect.stringContaining("Tenant not found") });
  });

  it("rejects duplicate tenant+connection assignment", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    await svc.assignConnectionToTenant(tenant.id, { apiConnectionId: "conn-uuid-1" });

    await expect(
      svc.assignConnectionToTenant(tenant.id, { apiConnectionId: "conn-uuid-1" })
    ).rejects.toMatchObject({ message: expect.stringContaining("already assigned") });
  });

  it("clears old default when new default is set", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    await svc.assignConnectionToTenant(tenant.id, { apiConnectionId: "conn-1", isDefault: true });
    await svc.assignConnectionToTenant(tenant.id, { apiConnectionId: "conn-2", isDefault: true });

    const conns = await svc.listTenantConnections(tenant.id);
    const defaults = conns.filter(c => c.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].apiConnectionId).toBe("conn-2");
  });

  it("assigns an alias to a connection", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    const conn = await svc.assignConnectionToTenant(tenant.id, {
      apiConnectionId: "conn-1",
      alias: "legacy-erp"
    });

    expect(conn.alias).toBe("legacy-erp");
  });
});

describe("TenantService — assignUserToTenant / verifyUserTenantAccess", () => {
  it("assigns a user to a tenant", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    const access = await svc.assignUserToTenant(tenant.id, { userId: "user-1", role: "bridge.admin" });

    expect(access.userId).toBe("user-1");
    expect(access.tenantId).toBe(tenant.id);
    expect(access.role).toBe("bridge.admin");
    expect(access.status).toBe("active");
  });

  it("rejects duplicate user assignment", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    await svc.assignUserToTenant(tenant.id, { userId: "user-1", role: "bridge.admin" });

    await expect(
      svc.assignUserToTenant(tenant.id, { userId: "user-1", role: "bridge.consumer" })
    ).rejects.toMatchObject({ message: expect.stringContaining("already has access") });
  });

  it("rejects assignment to unknown tenant", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    await expect(
      svc.assignUserToTenant("no-tenant", { userId: "user-1", role: "bridge.admin" })
    ).rejects.toMatchObject({ message: expect.stringContaining("Tenant not found") });
  });

  it("verifyUserTenantAccess returns true for active access", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    await svc.assignUserToTenant(tenant.id, { userId: "user-1", role: "bridge.admin" });

    expect(await svc.verifyUserTenantAccess("user-1", tenant.id)).toBe(true);
  });

  it("verifyUserTenantAccess returns false for user not in tenant", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });

    expect(await svc.verifyUserTenantAccess("stranger", tenant.id)).toBe(false);
  });

  it("verifyUserTenantAccess returns false for suspended access", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    // Manually insert a suspended record directly into the store
    store._access.push({
      id: "access-1",
      userId: "user-1",
      tenantId: tenant.id,
      role: "bridge.admin",
      status: "suspended",
      createdAt: NOW,
      updatedAt: NOW
    });

    expect(await svc.verifyUserTenantAccess("user-1", tenant.id)).toBe(false);
  });

  it("verifyUserTenantAccess returns false for inactive tenant", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    // Manually mark the tenant as archived
    store._tenants[0].status = "archived";
    await svc.assignUserToTenant(tenant.id, { userId: "user-1", role: "bridge.admin" });

    expect(await svc.verifyUserTenantAccess("user-1", tenant.id)).toBe(false);
  });
});

describe("TenantService — resolveDefaultConnectionForTenant", () => {
  it("returns apiConnectionId of default connection", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    await svc.assignConnectionToTenant(tenant.id, { apiConnectionId: "conn-uuid-1", isDefault: true });

    const result = await svc.resolveDefaultConnectionForTenant(tenant.id);
    expect(result).toBe("conn-uuid-1");
  });

  it("returns null when no default connection is set", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    await svc.assignConnectionToTenant(tenant.id, { apiConnectionId: "conn-uuid-1", isDefault: false });

    const result = await svc.resolveDefaultConnectionForTenant(tenant.id);
    expect(result).toBeNull();
  });

  it("returns null for a tenant with no connections at all", async () => {
    const store = createMemoryStore();
    const svc = createTenantService(store);

    const tenant = await svc.createTenant({ code: "t1", name: "T1" });
    const result = await svc.resolveDefaultConnectionForTenant(tenant.id);
    expect(result).toBeNull();
  });
});
