import type { OraclePaginationStrategy } from "../contracts/index.js";
import type {
  OracleAdapterConnectionConfig,
  OracleConnectionRecord,
  OracleConnectionRegistryStore,
  OracleConnectorAdapter
} from "./index.js";

export type OracleCapabilities = {
  versionString: string;
  majorVersion: number | null;
  paginationStrategy: OraclePaginationStrategy;
};

export type OracleCapabilityDetectorOptions = {
  store: OracleConnectionRegistryStore;
  adapterFactory: () => OracleConnectorAdapter;
  resolvePassword?: (connection: OracleConnectionRecord) => Promise<string | undefined> | string | undefined;
};

export type OracleCapabilityDetector = {
  detectOracleCapabilities(connectionId: string): Promise<OracleCapabilities>;
};

type OracleVersionRow = {
  BANNER?: unknown;
  banner?: unknown;
  VERSION?: unknown;
  version?: unknown;
};

const VERSION_QUERY = "SELECT banner FROM v$version WHERE banner LIKE :databaseBanner";

export function createOracleCapabilityDetector(options: OracleCapabilityDetectorOptions): OracleCapabilityDetector {
  return {
    async detectOracleCapabilities(connectionId) {
      const connection = await options.store.apiConnection.findUnique({ where: { id: connectionId } });
      if (!connection) {
        throw new Error(`Oracle connection not found: ${connectionId}`);
      }

      const adapter = options.adapterFactory();
      await adapter.openConnection(await toAdapterConfig(connection, options.resolvePassword));

      try {
        const result = await adapter.query<OracleVersionRow>(
          VERSION_QUERY,
          { databaseBanner: "Oracle Database%" },
          { maxRows: 5, outFormat: "object" }
        );
        const versionString = extractVersionString(result.rows);
        const majorVersion = parseOracleMajorVersion(versionString);
        const paginationStrategy = selectPaginationStrategy(majorVersion);

        await options.store.apiConnection.update({
          where: { id: connectionId },
          data: {
            oracleVersion: versionString,
            paginationStrategy
          }
        });

        return {
          versionString,
          majorVersion,
          paginationStrategy
        };
      } finally {
        await adapter.close();
      }
    }
  };
}

export function parseOracleMajorVersion(versionString: string): number | null {
  const marketingVersion = versionString.match(/\b(\d{1,2})(?:c|g|i)\b/i);
  if (marketingVersion?.[1]) {
    return Number(marketingVersion[1]);
  }

  const releaseVersion = versionString.match(/\bRelease\s+(\d{1,2})(?:\.|$)/i);
  if (releaseVersion?.[1]) {
    return Number(releaseVersion[1]);
  }

  const dottedVersion = versionString.match(/\b(\d{1,2})\.\d+\.\d+/);
  if (dottedVersion?.[1]) {
    return Number(dottedVersion[1]);
  }

  return null;
}

export function selectPaginationStrategy(majorVersion: number | null): OraclePaginationStrategy {
  if (majorVersion !== null && majorVersion >= 12) {
    return "offsetFetch";
  }
  return "rownum";
}

async function toAdapterConfig(
  connection: OracleConnectionRecord,
  resolvePassword: OracleCapabilityDetectorOptions["resolvePassword"]
): Promise<OracleAdapterConnectionConfig> {
  return {
    user: connection.username,
    password: await resolvePassword?.(connection) ?? connection.encryptedPassword ?? undefined,
    connectString: buildConnectString(connection),
    host: connection.host ?? undefined,
    port: connection.port ?? undefined,
    serviceName: connection.serviceName ?? undefined,
    sid: connection.sid ?? undefined,
    walletLocation: connection.walletPath ?? undefined
  };
}

function buildConnectString(connection: OracleConnectionRecord): string | undefined {
  if (connection.connectionType === "tnsAlias" || connection.connectionType === "wallet") {
    return connection.tnsAlias ?? connection.serviceName ?? undefined;
  }

  if (connection.host && connection.port && connection.serviceName) {
    return `${connection.host}:${connection.port}/${connection.serviceName}`;
  }

  if (connection.host && connection.port && connection.sid) {
    return `${connection.host}:${connection.port}:${connection.sid}`;
  }

  return connection.serviceName ?? connection.sid ?? undefined;
}

function extractVersionString(rows: OracleVersionRow[]): string {
  for (const row of rows) {
    const value = row.BANNER ?? row.banner ?? row.VERSION ?? row.version;
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "unknown";
}
