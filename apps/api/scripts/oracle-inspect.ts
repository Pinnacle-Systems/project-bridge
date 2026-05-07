import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env, loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import type { OracleConnectionRecord } from "../src/bridge/connections/index.js";
import { createOracleConnectorAdapter } from "../src/bridge/connections/oracle-adapter.js";
import {
  createOracleSchemaInspector,
  type OracleSchemaInspectorStore,
  type OracleSchemaSnapshot,
  type StoredOracleSchemaSnapshot
} from "../src/bridge/oracleInspector/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const envFiles = [resolve(scriptDir, "../../../.env"), resolve(scriptDir, "../.env")];

for (const envFile of envFiles) {
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }
}

const driverMode = env.ORACLE_DRIVER_MODE ?? env.NODE_ORACLEDB_DRIVER_MODE;
const clientLibDir = env.ORACLE_CLIENT_LIB_DIR;

if (process.platform === "linux" && driverMode === "thick" && clientLibDir) {
  const libraryPaths = (env.LD_LIBRARY_PATH ?? "").split(":").filter(Boolean);
  if (!libraryPaths.includes(clientLibDir) && env.PROJECT_BRIDGE_ORACLE_INSPECT_REEXEC !== "1") {
    const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      env: {
        ...env,
        LD_LIBRARY_PATH: [clientLibDir, ...libraryPaths].join(":"),
        PROJECT_BRIDGE_ORACLE_INSPECT_REEXEC: "1"
      },
      stdio: "inherit"
    });

    process.exit(result.status ?? 1);
  }
}

const owner = requiredEnv("ORACLE_OWNER").toUpperCase();
const connection = createConnectionRecord(owner);
const snapshots: StoredOracleSchemaSnapshot[] = [];

const store: OracleSchemaInspectorStore = {
  apiConnection: {
    async create() {
      throw new Error("oracle-inspect does not create connection records.");
    },
    async update() {
      throw new Error("oracle-inspect does not update connection records.");
    },
    async findUnique({ where }) {
      return where.id === connection.id ? connection : null;
    },
    async findMany() {
      return [connection];
    }
  },
  oracleSchemaSnapshot: {
    async create({ data }) {
      const storedSnapshot: StoredOracleSchemaSnapshot = {
        id: randomUUID(),
        apiConnectionId: data.apiConnectionId,
        oracleOwner: data.oracleOwner,
        snapshotData: data.snapshotData,
        capturedAt: new Date(),
        capturedBy: data.capturedBy ?? null
      };
      snapshots.push(storedSnapshot);
      return storedSnapshot;
    }
  }
};

const { default: oracledb } = await import("oracledb");

if (driverMode === "thick" || clientLibDir) {
  oracledb.initOracleClient(clientLibDir ? { libDir: clientLibDir } : undefined);
}

const inspector = createOracleSchemaInspector({
  store,
  adapterFactory: () => createOracleConnectorAdapter(oracledb),
  resolvePassword: () => requiredEnv("ORACLE_PASSWORD"),
  capturedBy: "oracle-inspect"
});

const { snapshot } = await inspector.inspectOracleSchema(connection.id, owner);
printSnapshotSummary(snapshot);

function createConnectionRecord(defaultOwner: string): OracleConnectionRecord {
  const now = new Date();
  return {
    id: env.ORACLE_CONNECTION_ID ?? randomUUID(),
    name: env.ORACLE_CONNECTION_NAME ?? `${defaultOwner} Oracle inspection`,
    connectionType: "serviceName",
    host: env.ORACLE_HOST ?? null,
    port: env.ORACLE_PORT ? Number(env.ORACLE_PORT) : null,
    serviceName: env.ORACLE_SERVICE_NAME ?? env.ORACLE_CONNECT_STRING ?? null,
    sid: env.ORACLE_SID ?? null,
    tnsAlias: env.ORACLE_TNS_ALIAS ?? null,
    username: requiredEnv("ORACLE_USER"),
    encryptedPassword: null,
    passwordSecretRef: "env:ORACLE_PASSWORD",
    walletPath: null,
    walletSecretRef: null,
    defaultOwner,
    oracleVersion: null,
    paginationStrategy: "rownum",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
}

function printSnapshotSummary(snapshot: OracleSchemaSnapshot): void {
  const objectPreview = snapshot.objects.slice(0, 10).map((object) => ({
    name: object.objectName,
    type: object.objectType,
    status: object.objectStatus,
    columns: object.columns.length,
    constraints: object.constraints.length,
    indexes: object.indexes.length
  }));

  const programPreview = snapshot.programUnits.slice(0, 10).map((unit) => ({
    package: unit.packageName,
    name: unit.name,
    type: unit.unitType,
    status: unit.objectStatus,
    arguments: unit.arguments.length,
    returnType: unit.returnType
  }));

  console.log("Oracle schema snapshot:", {
    owner: snapshot.owner,
    inspectedAt: snapshot.inspectedAt,
    objects: snapshot.objects.length,
    sequences: snapshot.sequences.length,
    programUnits: snapshot.programUnits.length,
    storedSnapshots: snapshots.length
  });
  console.log("Object preview:", objectPreview);
  console.log("Sequence preview:", snapshot.sequences.slice(0, 10));
  console.log("Program unit preview:", programPreview);
}

function requiredEnv(name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
