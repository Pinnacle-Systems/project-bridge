import { describe, expect, it } from "vitest";

import {
  createOracleConnectionRegistry,
  toSafeConnection,
  type OracleConnectionRecord,
  type OracleConnectionRegistryStore
} from "../index.js";

function connectionRecord(overrides: Partial<OracleConnectionRecord> = {}): OracleConnectionRecord {
  return {
    id: "40f7b93b-4cc6-44a3-9f90-b142cf2f0f5d",
    name: "Legacy ERP",
    connectionType: "serviceName",
    host: "localhost",
    port: 1521,
    serviceName: "ERPDB",
    sid: null,
    tnsAlias: null,
    username: "erp_api",
    encryptedPassword: "encrypted-password-value",
    passwordSecretRef: "secret/oracle/password",
    walletPath: "/secure/wallet",
    walletSecretRef: "secret/oracle/wallet",
    defaultOwner: "ERP_OWNER",
    oracleVersion: "19c",
    paginationStrategy: "offsetFetch",
    status: "unverified",
    createdAt: new Date("2026-05-06T00:00:00.000Z"),
    updatedAt: new Date("2026-05-06T00:00:00.000Z"),
    ...overrides
  };
}

function createMemoryStore(records: OracleConnectionRecord[] = []): OracleConnectionRegistryStore {
  return {
    apiConnection: {
      async create({ data }) {
        const record = connectionRecord({
          ...data,
          id: "created-connection-id",
          host: data.host ?? null,
          port: data.port ?? null,
          serviceName: data.serviceName ?? null,
          sid: data.sid ?? null,
          tnsAlias: data.tnsAlias ?? null,
          encryptedPassword: data.encryptedPassword ?? null,
          passwordSecretRef: data.passwordSecretRef ?? null,
          walletPath: data.walletPath ?? null,
          walletSecretRef: data.walletSecretRef ?? null,
          defaultOwner: data.defaultOwner ?? null,
          oracleVersion: data.oracleVersion ?? null,
          paginationStrategy: data.paginationStrategy ?? null
        });
        records.push(record);
        return record;
      },

      async update({ where, data }) {
        const existing = records.find((record) => record.id === where.id);
        if (!existing) {
          throw new Error("Connection not found.");
        }
        Object.assign(existing, data, { updatedAt: new Date("2026-05-06T01:00:00.000Z") });
        return existing;
      },

      async findUnique({ where }) {
        return records.find((record) => record.id === where.id) ?? null;
      },

      async findMany() {
        return [...records].sort((left, right) => left.name.localeCompare(right.name));
      }
    }
  };
}

describe("Oracle connection registry", () => {
  it("redacts password and wallet secret material from safe output", () => {
    const safeConnection = toSafeConnection(connectionRecord());

    expect(safeConnection).not.toHaveProperty("encryptedPassword");
    expect(safeConnection).not.toHaveProperty("passwordSecretRef");
    expect(safeConnection).not.toHaveProperty("walletPath");
    expect(safeConnection).not.toHaveProperty("walletSecretRef");
    expect(safeConnection.hasEncryptedPassword).toBe(true);
    expect(safeConnection.hasPasswordSecret).toBe(true);
    expect(safeConnection.hasWalletPath).toBe(true);
    expect(safeConnection.hasWalletSecret).toBe(true);
  });

  it("creates connections and returns only safe metadata", async () => {
    const registry = createOracleConnectionRegistry(createMemoryStore());

    const connection = await registry.createConnection({
      name: "Legacy ERP",
      connectionType: "serviceName",
      host: "localhost",
      port: 1521,
      serviceName: "ERPDB",
      username: "erp_api",
      passwordSecretRef: "secret/oracle/password",
      defaultOwner: "ERP_OWNER",
      oracleVersion: "19c",
      paginationStrategy: "offsetFetch"
    });

    expect(connection.name).toBe("Legacy ERP");
    expect(connection.status).toBe("unverified");
    expect(connection.hasPasswordSecret).toBe(true);
    expect(connection).not.toHaveProperty("passwordSecretRef");
  });

  it("returns redacted connections from get, list, update, and status methods", async () => {
    const records = [connectionRecord({ id: "conn-1", status: "unverified" })];
    const registry = createOracleConnectionRegistry(createMemoryStore(records));

    const fetched = await registry.getConnectionSafe("conn-1");
    const listed = await registry.listConnections();
    const updated = await registry.updateConnection("conn-1", { oracleVersion: "21c" });
    const active = await registry.markConnectionStatus("conn-1", "active");

    for (const connection of [fetched, listed[0], updated, active]) {
      expect(connection).not.toHaveProperty("encryptedPassword");
      expect(connection).not.toHaveProperty("passwordSecretRef");
      expect(connection).not.toHaveProperty("walletSecretRef");
    }
    expect(updated.oracleVersion).toBe("21c");
    expect(active.status).toBe("active");
  });
});
