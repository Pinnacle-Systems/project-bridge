import { describe, expect, it, vi } from "vitest";

import {
  createOracleCapabilityDetector,
  parseOracleMajorVersion,
  selectPaginationStrategy,
  type OracleConnectionRecord,
  type OracleConnectionRegistryStore,
  type OracleConnectorAdapter,
  type QueryResult
} from "../index.js";

function connectionRecord(overrides: Partial<OracleConnectionRecord> = {}): OracleConnectionRecord {
  return {
    id: "conn-1",
    name: "Legacy ERP",
    connectionType: "serviceName",
    host: "localhost",
    port: 1521,
    serviceName: "ERPDB",
    sid: null,
    tnsAlias: null,
    username: "erp_api",
    encryptedPassword: "encrypted-password-value",
    passwordSecretRef: null,
    walletPath: null,
    walletSecretRef: null,
    defaultOwner: "ERP_OWNER",
    oracleVersion: null,
    paginationStrategy: null,
    status: "unverified",
    createdAt: new Date("2026-05-06T00:00:00.000Z"),
    updatedAt: new Date("2026-05-06T00:00:00.000Z"),
    ...overrides
  };
}

function createMemoryStore(record: OracleConnectionRecord) {
  const updates: unknown[] = [];
  const store: OracleConnectionRegistryStore = {
    apiConnection: {
      async create() {
        throw new Error("not used");
      },
      async update({ data }) {
        updates.push(data);
        Object.assign(record, data);
        return record;
      },
      async findUnique() {
        return record;
      },
      async findMany() {
        return [record];
      }
    }
  };

  return { store, updates };
}

function createMockAdapter(versionString: string): OracleConnectorAdapter {
  return {
    openConnection: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => true),
    async query<Row = unknown>(): Promise<QueryResult<Row>> {
      return {
      rows: (versionString === "unknown" ? [] : [{ BANNER: versionString }]) as Row[]
      };
    },
    execute: vi.fn(async () => ({
      rows: []
    })),
    executePlsqlBlock: vi.fn(async () => ({
      rows: []
    })),
    executeProcedure: vi.fn(async () => ({
      rows: []
    }))
  };
}

async function detect(versionString: string) {
  const connection = connectionRecord();
  const { store, updates } = createMemoryStore(connection);
  const adapter = createMockAdapter(versionString);
  const detector = createOracleCapabilityDetector({
    store,
    adapterFactory: () => adapter,
    resolvePassword: () => "resolved-password"
  });

  return {
    adapter,
    updates,
    capabilities: await detector.detectOracleCapabilities(connection.id)
  };
}

describe("Oracle capability detection", () => {
  it("selects offsetFetch for 19c", async () => {
    const { capabilities, updates } = await detect(
      "Oracle Database 19c Enterprise Edition Release 19.0.0.0.0 - Production"
    );

    expect(capabilities).toEqual({
      versionString: "Oracle Database 19c Enterprise Edition Release 19.0.0.0.0 - Production",
      majorVersion: 19,
      paginationStrategy: "offsetFetch"
    });
    expect(updates).toContainEqual({
      oracleVersion: capabilities.versionString,
      paginationStrategy: "offsetFetch"
    });
  });

  it("selects offsetFetch for 12c", async () => {
    const { capabilities } = await detect(
      "Oracle Database 12c Enterprise Edition Release 12.1.0.2.0 - 64bit Production"
    );

    expect(capabilities.majorVersion).toBe(12);
    expect(capabilities.paginationStrategy).toBe("offsetFetch");
  });

  it("selects rownum for 11g", async () => {
    const { capabilities } = await detect(
      "Oracle Database 11g Enterprise Edition Release 11.2.0.4.0 - 64bit Production"
    );

    expect(capabilities.majorVersion).toBe(11);
    expect(capabilities.paginationStrategy).toBe("rownum");
  });

  it("defaults unknown versions safely to rownum", async () => {
    const { capabilities } = await detect("unknown");

    expect(capabilities).toEqual({
      versionString: "unknown",
      majorVersion: null,
      paginationStrategy: "rownum"
    });
  });

  it("parses standalone version helpers", () => {
    expect(parseOracleMajorVersion("Oracle Database 19c")).toBe(19);
    expect(parseOracleMajorVersion("Release 12.2.0.1.0")).toBe(12);
    expect(parseOracleMajorVersion("no version here")).toBeNull();
    expect(selectPaginationStrategy(null)).toBe("rownum");
  });
});
