// Tenant resolution helpers — Phase 9a/9b.
//
// These helpers will be wired into the runtime request lifecycle in Phase 9e.
// They are defined here so they can be tested independently of the HTTP layer.

import type { Principal } from "./index.js";
import type { TenantService } from "../tenants/index.js";

export type TenantContext = {
  tenantId: string;
  apiConnectionId: string;
};

export type TenantResolutionError =
  | { kind: "UNAUTHENTICATED" }
  | { kind: "TENANT_NOT_IN_PRINCIPAL"; tenantId: string }
  | { kind: "TENANT_ACCESS_DENIED"; tenantId: string }
  | { kind: "NO_DEFAULT_CONNECTION"; tenantId: string };

export type TenantResolutionResult =
  | { ok: true; context: TenantContext }
  | { ok: false; error: TenantResolutionError };

export type TenantResolver = {
  resolveTenant(principal: Principal | null, tenantId: string): Promise<TenantResolutionResult>;
};

export function createTenantResolver(tenants: TenantService): TenantResolver {
  return {
    async resolveTenant(principal, tenantId) {
      if (!principal) {
        return { ok: false, error: { kind: "UNAUTHENTICATED" } };
      }

      // Verify the tenant is listed in the principal's tenantIds (from token/headers).
      if (!principal.tenantIds.includes(tenantId)) {
        return { ok: false, error: { kind: "TENANT_NOT_IN_PRINCIPAL", tenantId } };
      }

      // Verify the user actually has active access in the tenant store.
      const hasAccess = await tenants.verifyUserTenantAccess(principal.userId, tenantId);
      if (!hasAccess) {
        return { ok: false, error: { kind: "TENANT_ACCESS_DENIED", tenantId } };
      }

      // Resolve the default api connection for this tenant.
      const apiConnectionId = await tenants.resolveDefaultConnectionForTenant(tenantId);
      if (!apiConnectionId) {
        return { ok: false, error: { kind: "NO_DEFAULT_CONNECTION", tenantId } };
      }

      return { ok: true, context: { tenantId, apiConnectionId } };
    }
  };
}
