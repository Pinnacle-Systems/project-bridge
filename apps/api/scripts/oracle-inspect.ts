import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env, loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";

import type { OracleConnectionRecord } from "../src/bridge/connections/index.js";
import { createOracleConnectorAdapter } from "../src/bridge/connections/oracle-adapter.js";
import {
  createOracleSchemaInspector,
  type OracleSchemaInspectorStore,
  type OracleSchemaSnapshot,
  type StoredOracleSchemaSnapshot
} from "../src/bridge/oracleInspector/index.js";
import { PrismaClient } from "../src/generated/prisma/client.js";

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
const metadataDatabaseUrl =
  env.DATABASE_URL ?? "postgresql://postgres:mysecretpassword@localhost:5432/postgres?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: metadataDatabaseUrl })
});

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
      const storedSnapshot = await prisma.oracleSchemaSnapshot.create({
        data
      });
      return storedSnapshot as unknown as StoredOracleSchemaSnapshot;
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

try {
  await upsertConnectionRecord(connection);
  const { snapshot, storedSnapshot } = await inspector.inspectOracleSchema(connection.id, owner);
  printSnapshotSummary(snapshot, storedSnapshot);
} finally {
  await prisma.$disconnect();
}

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

async function upsertConnectionRecord(record: OracleConnectionRecord): Promise<void> {
  await prisma.apiConnection.upsert({
    where: { id: record.id },
    create: {
      id: record.id,
      name: record.name,
      connectionType: record.connectionType,
      host: record.host,
      port: record.port,
      serviceName: record.serviceName,
      sid: record.sid,
      tnsAlias: record.tnsAlias,
      username: record.username,
      encryptedPassword: record.encryptedPassword,
      passwordSecretRef: record.passwordSecretRef,
      walletPath: record.walletPath,
      walletSecretRef: record.walletSecretRef,
      defaultOwner: record.defaultOwner,
      oracleVersion: record.oracleVersion,
      paginationStrategy: record.paginationStrategy,
      status: record.status
    },
    update: {
      name: record.name,
      connectionType: record.connectionType,
      host: record.host,
      port: record.port,
      serviceName: record.serviceName,
      sid: record.sid,
      tnsAlias: record.tnsAlias,
      username: record.username,
      encryptedPassword: record.encryptedPassword,
      passwordSecretRef: record.passwordSecretRef,
      walletPath: record.walletPath,
      walletSecretRef: record.walletSecretRef,
      defaultOwner: record.defaultOwner,
      oracleVersion: record.oracleVersion,
      paginationStrategy: record.paginationStrategy,
      status: record.status
    }
  });
}

function printSnapshotSummary(snapshot: OracleSchemaSnapshot, storedSnapshot: StoredOracleSchemaSnapshot): void {
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
    snapshotId: storedSnapshot.id,
    connectionId: storedSnapshot.apiConnectionId,
    owner: snapshot.owner,
    inspectedAt: snapshot.inspectedAt,
    objects: snapshot.objects.length,
    sequences: snapshot.sequences.length,
    programUnits: snapshot.programUnits.length,
    storedAt: storedSnapshot.capturedAt
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
