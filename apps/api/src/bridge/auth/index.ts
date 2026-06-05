// Authentication foundation — Phase 9a.
//
// Defines the Principal type and PrincipalProvider interface.
// The StubPrincipalProvider is for internal/dev use: it reads identity from
// request headers and never validates a JWT. Replace with a real JWT/OIDC
// provider before production use.

export type Principal = {
  userId: string;
  username?: string;
  roles: string[];
  tenantIds: string[];
  permissions: string[];
};

// Minimal request surface needed by the principal provider.
export type AuthRequest = {
  get(headerName: string): string | undefined;
};

export type PrincipalProvider = {
  resolvePrincipal(req: AuthRequest): Principal | null;
};

// ── Stub provider ─────────────────────────────────────────────────────────────
//
// Reads from these headers (internal/dev mode only):
//   x-bridge-user-id    — required; null principal if absent
//   x-bridge-username   — optional display name
//   x-bridge-tenant-id  — comma-separated list of tenant IDs
//   x-bridge-roles      — comma-separated list of roles
//   x-bridge-permissions — comma-separated list of permission strings
//
// Never validated against a JWT. Do not use in production.

export function createStubPrincipalProvider(): PrincipalProvider {
  return {
    resolvePrincipal(req) {
      const userId = req.get("x-bridge-user-id");
      if (!userId || !userId.trim()) return null;

      const username = req.get("x-bridge-username")?.trim() || undefined;
      const tenantIds = parseCommaSeparated(req.get("x-bridge-tenant-id"));
      const roles = parseCommaSeparated(req.get("x-bridge-roles"));
      const permissions = parseCommaSeparated(req.get("x-bridge-permissions"));

      return { userId: userId.trim(), username, tenantIds, roles, permissions };
    }
  };
}

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map(s => s.trim()).filter(Boolean);
}
