import { describe, expect, it } from "vitest";
import { createTenantResolver } from "../tenant-resolution.js";
import type { TenantService } from "../../tenants/index.js";
import type { Principal } from "../index.js";

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: "user-1",
    roles: [],
    tenantIds: ["tenant-abc"],
    permissions: [],
    ...overrides
  };
}

function makeTenantService(overrides: Partial<TenantService> = {}): TenantService {
  return {
    createTenant: async () => { throw new Error("not needed"); },
    listTenants: async () => [],
    getTenant: async () => null,
    assignConnectionToTenant: async () => { throw new Error("not needed"); },
    listTenantConnections: async () => [],
    assignUserToTenant: async () => { throw new Error("not needed"); },
    listUserTenantAccess: async () => [],
    verifyUserTenantAccess: async () => true,
    resolveDefaultConnectionForTenant: async () => "conn-uuid-1",
    ...overrides
  };
}

describe("TenantResolver", () => {
  it("resolves tenant context for valid principal + access + default connection", async () => {
    const resolver = createTenantResolver(makeTenantService());
    const result = await resolver.resolveTenant(principal(), "tenant-abc");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.tenantId).toBe("tenant-abc");
      expect(result.context.apiConnectionId).toBe("conn-uuid-1");
    }
  });

  it("returns UNAUTHENTICATED when principal is null", async () => {
    const resolver = createTenantResolver(makeTenantService());
    const result = await resolver.resolveTenant(null, "tenant-abc");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("UNAUTHENTICATED");
  });

  it("returns TENANT_NOT_IN_PRINCIPAL when tenant is not in principal tenantIds", async () => {
    const resolver = createTenantResolver(makeTenantService());
    const result = await resolver.resolveTenant(
      principal({ tenantIds: ["tenant-other"] }),
      "tenant-abc"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("TENANT_NOT_IN_PRINCIPAL");
      expect((result.error as { kind: string; tenantId: string }).tenantId).toBe("tenant-abc");
    }
  });

  it("returns TENANT_ACCESS_DENIED when user has no DB access to tenant", async () => {
    const resolver = createTenantResolver(
      makeTenantService({ verifyUserTenantAccess: async () => false })
    );
    const result = await resolver.resolveTenant(principal(), "tenant-abc");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("TENANT_ACCESS_DENIED");
  });

  it("returns NO_DEFAULT_CONNECTION when tenant has no default connection", async () => {
    const resolver = createTenantResolver(
      makeTenantService({ resolveDefaultConnectionForTenant: async () => null })
    );
    const result = await resolver.resolveTenant(principal(), "tenant-abc");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NO_DEFAULT_CONNECTION");
  });
});
