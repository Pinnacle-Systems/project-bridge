import type { OraclePaginationStrategy } from "../contracts/index.js";

export type OracleConnectionType = "serviceName" | "sid" | "tnsAlias" | "wallet";

export type OracleConnectionStatus = "unverified" | "active" | "inactive" | "invalid";

export type OracleConnectionConfig = {
  id: string;
  name: string;
  owner?: string;
  connectionMode: OracleConnectionType;
};

export type ConnectionStatus = OracleConnectionStatus;

export type OracleConnectionRecord = {
  id: string;
  name: string;
  connectionType: OracleConnectionType;
  host: string | null;
  port: number | null;
  serviceName: string | null;
  sid: string | null;
  tnsAlias: string | null;
  username: string;
  encryptedPassword: string | null;
  passwordSecretRef: string | null;
  walletPath: string | null;
  walletSecretRef: string | null;
  defaultOwner: string | null;
  oracleVersion: string | null;
  paginationStrategy: OraclePaginationStrategy | null;
  status: OracleConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type OracleConnectionSafe = Omit<
  OracleConnectionRecord,
  "encryptedPassword" | "passwordSecretRef" | "walletPath" | "walletSecretRef"
> & {
  hasEncryptedPassword: boolean;
  hasPasswordSecret: boolean;
  hasWalletPath: boolean;
  hasWalletSecret: boolean;
};

export type CreateOracleConnectionInput = {
  name: string;
  connectionType: OracleConnectionType;
  host?: string;
  port?: number;
  serviceName?: string;
  sid?: string;
  tnsAlias?: string;
  username: string;
  encryptedPassword?: string;
  passwordSecretRef?: string;
  walletPath?: string;
  walletSecretRef?: string;
  defaultOwner?: string;
  oracleVersion?: string;
  paginationStrategy?: OraclePaginationStrategy;
  status?: OracleConnectionStatus;
};

export type UpdateOracleConnectionInput = Partial<CreateOracleConnectionInput>;

export type OracleConnectionStatusUpdate = Pick<OracleConnectionRecord, "status">;

export type OracleConnectionRegistryStore = {
  apiConnection: {
    create(args: { data: CreateOracleConnectionInput & { status: OracleConnectionStatus } }): Promise<OracleConnectionRecord>;
    update(args: {
      where: { id: string };
      data: UpdateOracleConnectionInput | OracleConnectionStatusUpdate;
    }): Promise<OracleConnectionRecord>;
    findUnique(args: { where: { id: string } }): Promise<OracleConnectionRecord | null>;
    findMany(args?: { orderBy?: { name?: "asc" | "desc"; createdAt?: "asc" | "desc" } }): Promise<OracleConnectionRecord[]>;
  };
};

export type OracleConnectionRegistry = {
  createConnection(input: CreateOracleConnectionInput): Promise<OracleConnectionSafe>;
  updateConnection(id: string, input: UpdateOracleConnectionInput): Promise<OracleConnectionSafe>;
  getConnectionSafe(id: string): Promise<OracleConnectionSafe | null>;
  listConnections(): Promise<OracleConnectionSafe[]>;
  markConnectionStatus(id: string, status: OracleConnectionStatus): Promise<OracleConnectionSafe>;
};

export function createOracleConnectionRegistry(store: OracleConnectionRegistryStore): OracleConnectionRegistry {
  return {
    async createConnection(input) {
      const record = await store.apiConnection.create({
        data: {
          ...normalizeConnectionInput(input),
          status: input.status ?? "unverified"
        }
      });

      return toSafeConnection(record);
    },

    async updateConnection(id, input) {
      const record = await store.apiConnection.update({
        where: { id },
        data: normalizeConnectionInput(input)
      });

      return toSafeConnection(record);
    },

    async getConnectionSafe(id) {
      const record = await store.apiConnection.findUnique({ where: { id } });
      return record ? toSafeConnection(record) : null;
    },

    async listConnections() {
      const records = await store.apiConnection.findMany({ orderBy: { name: "asc" } });
      return records.map(toSafeConnection);
    },

    async markConnectionStatus(id, status) {
      const record = await store.apiConnection.update({
        where: { id },
        data: { status }
      });

      return toSafeConnection(record);
    }
  };
}

export function toSafeConnection(record: OracleConnectionRecord): OracleConnectionSafe {
  const {
    encryptedPassword,
    passwordSecretRef,
    walletPath,
    walletSecretRef,
    ...safeConnection
  } = record;

  return {
    ...safeConnection,
    hasEncryptedPassword: Boolean(encryptedPassword),
    hasPasswordSecret: Boolean(passwordSecretRef),
    hasWalletPath: Boolean(walletPath),
    hasWalletSecret: Boolean(walletSecretRef)
  };
}

function normalizeConnectionInput<T extends UpdateOracleConnectionInput>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as T;
}

export * from "./oracle-adapter.js";
export * from "./oracle-capabilities.js";
