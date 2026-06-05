import { HttpError } from "../../error-handler.js";

// ── Stored types (mirror Prisma model fields) ─────────────────────────────────

export type StoredBridgeTenant = {
  id: string;
  code: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredBridgeTenantConnection = {
  id: string;
  tenantId: string;
  apiConnectionId: string;
  alias: string | null;
  isDefault: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredBridgeUserTenantAccess = {
  id: string;
  userId: string;
  tenantId: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

// ── Store interface ──────────────────────────────────────────────────────────

export type BridgeTenantStore = {
  bridgeTenant: {
    create(args: {
      data: { id?: string; code: string; name: string; status: string };
    }): Promise<StoredBridgeTenant>;
    update(args: {
      where: { id: string };
      data: Partial<{ name: string; status: string }>;
    }): Promise<StoredBridgeTenant>;
    findUnique(args: { where: { id: string } | { code: string } }): Promise<StoredBridgeTenant | null>;
    findMany(args?: {
      where?: { status?: string };
      orderBy?: { code?: "asc" | "desc"; createdAt?: "asc" | "desc" };
    }): Promise<StoredBridgeTenant[]>;
  };
  bridgeTenantConnection: {
    create(args: {
      data: {
        tenantId: string;
        apiConnectionId: string;
        alias?: string | null;
        isDefault: boolean;
        status: string;
      };
    }): Promise<StoredBridgeTenantConnection>;
    update(args: {
      where: { id: string };
      data: Partial<{ isDefault: boolean; status: string }>;
    }): Promise<StoredBridgeTenantConnection>;
    findFirst(args?: {
      where?: { tenantId?: string; apiConnectionId?: string; isDefault?: boolean; status?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }): Promise<StoredBridgeTenantConnection | null>;
    findMany(args?: {
      where?: { tenantId?: string; status?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }): Promise<StoredBridgeTenantConnection[]>;
  };
  bridgeUserTenantAccess: {
    create(args: {
      data: { userId: string; tenantId: string; role: string; status: string };
    }): Promise<StoredBridgeUserTenantAccess>;
    findFirst(args?: {
      where?: { userId?: string; tenantId?: string; status?: string };
    }): Promise<StoredBridgeUserTenantAccess | null>;
    findMany(args?: {
      where?: { tenantId?: string; userId?: string; status?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }): Promise<StoredBridgeUserTenantAccess[]>;
  };
};

// ── Inputs ────────────────────────────────────────────────────────────────────

export type CreateTenantInput = {
  code: string;
  name: string;
};

export type AssignConnectionInput = {
  apiConnectionId: string;
  alias?: string;
  isDefault?: boolean;
};

export type AssignUserInput = {
  userId: string;
  role: string;
};

// ── Service interface ─────────────────────────────────────────────────────────

export type TenantService = {
  createTenant(input: CreateTenantInput): Promise<StoredBridgeTenant>;
  listTenants(): Promise<StoredBridgeTenant[]>;
  getTenant(id: string): Promise<StoredBridgeTenant | null>;
  assignConnectionToTenant(tenantId: string, input: AssignConnectionInput): Promise<StoredBridgeTenantConnection>;
  listTenantConnections(tenantId: string): Promise<StoredBridgeTenantConnection[]>;
  assignUserToTenant(tenantId: string, input: AssignUserInput): Promise<StoredBridgeUserTenantAccess>;
  listUserTenantAccess(tenantId: string): Promise<StoredBridgeUserTenantAccess[]>;
  verifyUserTenantAccess(userId: string, tenantId: string): Promise<boolean>;
  resolveDefaultConnectionForTenant(tenantId: string): Promise<string | null>;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTenantService(store: BridgeTenantStore): TenantService {
  return {
    async createTenant(input) {
      const { code, name } = input;
      if (!code || !code.trim()) {
        throw new HttpError(400, "INVALID_REQUEST", "Tenant code is required.");
      }
      if (!name || !name.trim()) {
        throw new HttpError(400, "INVALID_REQUEST", "Tenant name is required.");
      }

      const existing = await store.bridgeTenant.findUnique({ where: { code: code.trim() } });
      if (existing) {
        throw new HttpError(409, "DUPLICATE_TENANT_CODE", `Tenant with code '${code.trim()}' already exists.`);
      }

      return store.bridgeTenant.create({
        data: { code: code.trim(), name: name.trim(), status: "active" }
      });
    },

    async listTenants() {
      return store.bridgeTenant.findMany({ orderBy: { code: "asc" } });
    },

    async getTenant(id) {
      return store.bridgeTenant.findUnique({ where: { id } });
    },

    async assignConnectionToTenant(tenantId, input) {
      const { apiConnectionId, alias, isDefault = false } = input;

      if (!apiConnectionId) {
        throw new HttpError(400, "INVALID_REQUEST", "apiConnectionId is required.");
      }

      const tenant = await store.bridgeTenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant not found.");
      }

      const existing = await store.bridgeTenantConnection.findFirst({
        where: { tenantId, apiConnectionId }
      });
      if (existing) {
        throw new HttpError(409, "DUPLICATE_TENANT_CONNECTION", "This connection is already assigned to the tenant.");
      }

      if (alias !== undefined && alias !== null && alias.trim() !== "") {
        const aliasConflict = await store.bridgeTenantConnection.findFirst({
          where: { tenantId, status: "active" }
        });
        // Check alias conflict in memory (store may not support alias filter directly)
        const activeConns = await store.bridgeTenantConnection.findMany({ where: { tenantId } });
        const aliasInUse = activeConns.some(c => c.alias === alias.trim());
        if (aliasInUse) {
          throw new HttpError(409, "DUPLICATE_TENANT_CONNECTION_ALIAS", `Alias '${alias.trim()}' is already in use for this tenant.`);
        }
        void aliasConflict; // satisfy compiler
      }

      // If marking as default, clear the current default first.
      if (isDefault) {
        const currentDefault = await store.bridgeTenantConnection.findFirst({
          where: { tenantId, isDefault: true }
        });
        if (currentDefault) {
          await store.bridgeTenantConnection.update({
            where: { id: currentDefault.id },
            data: { isDefault: false }
          });
        }
      }

      return store.bridgeTenantConnection.create({
        data: {
          tenantId,
          apiConnectionId,
          alias: alias?.trim() ?? null,
          isDefault,
          status: "active"
        }
      });
    },

    async listTenantConnections(tenantId) {
      return store.bridgeTenantConnection.findMany({
        where: { tenantId },
        orderBy: { createdAt: "asc" }
      });
    },

    async assignUserToTenant(tenantId, input) {
      const { userId, role } = input;

      if (!userId || !userId.trim()) {
        throw new HttpError(400, "INVALID_REQUEST", "userId is required.");
      }
      if (!role || !role.trim()) {
        throw new HttpError(400, "INVALID_REQUEST", "role is required.");
      }

      const tenant = await store.bridgeTenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant not found.");
      }

      const existing = await store.bridgeUserTenantAccess.findFirst({
        where: { userId: userId.trim(), tenantId }
      });
      if (existing) {
        throw new HttpError(409, "DUPLICATE_USER_TENANT_ACCESS", "User already has access to this tenant.");
      }

      return store.bridgeUserTenantAccess.create({
        data: { userId: userId.trim(), tenantId, role: role.trim(), status: "active" }
      });
    },

    async listUserTenantAccess(tenantId) {
      return store.bridgeUserTenantAccess.findMany({
        where: { tenantId },
        orderBy: { createdAt: "asc" }
      });
    },

    async verifyUserTenantAccess(userId, tenantId) {
      const tenant = await store.bridgeTenant.findUnique({ where: { id: tenantId } });
      if (!tenant || tenant.status !== "active") return false;

      const access = await store.bridgeUserTenantAccess.findFirst({
        where: { userId, tenantId, status: "active" }
      });
      return access !== null;
    },

    async resolveDefaultConnectionForTenant(tenantId) {
      const conn = await store.bridgeTenantConnection.findFirst({
        where: { tenantId, isDefault: true, status: "active" }
      });
      return conn?.apiConnectionId ?? null;
    }
  };
}
