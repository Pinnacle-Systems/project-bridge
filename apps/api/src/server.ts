import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

// Load .env before anything else
const dir = dirname(fileURLToPath(import.meta.url));
for (const candidate of [resolve(dir, "../../../.env"), resolve(dir, "../.env")]) {
  loadDotenv({ path: candidate, quiet: true });
}

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { createOracleConnectorAdapter } from "./bridge/connections/oracle-adapter.js";
import { createOracleConnectionRegistry } from "./bridge/connections/index.js";
import { createOracleSchemaInspector } from "./bridge/oracleInspector/index.js";
import { createOracleCapabilityDetector } from "./bridge/connections/oracle-capabilities.js";
import { createDraftContractService } from "./bridge/contracts/draft-contracts.js";
import { createContractPublishService } from "./bridge/contracts/publish-contracts.js";
import { createOracleAwareContractCompiler } from "./bridge/compiler/index.js";
import { createContractCache } from "./bridge/contracts/contract-cache.js";
import { createPermissiveChecker } from "./bridge/runtime/permissions.js";
import type { BridgeHttpContext } from "./bridge/http/context.js";
import type { AuditLogger } from "./bridge/audit/index.js";
import { createApp } from "./app.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// ── Oracle driver setup ──────────────────────────────────────────────────────

const driverMode   = process.env.ORACLE_DRIVER_MODE ?? process.env.NODE_ORACLEDB_DRIVER_MODE;
const clientLibDir = process.env.ORACLE_CLIENT_LIB_DIR;

const { default: oracledb } = await import("oracledb");

if (driverMode === "thick" || clientLibDir) {
  oracledb.initOracleClient(clientLibDir ? { libDir: clientLibDir } : undefined);
}

// ── Prisma ───────────────────────────────────────────────────────────────────

const databaseUrl = requiredEnv("DATABASE_URL");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

// ── Audit logger (fire-and-forget writes to DB) ──────────────────────────────

const audit: AuditLogger = {
  log(event) {
    prisma.apiAuditLog.create({
      data: {
        eventType: event.type,
        actor: event.actor ?? null,
        metadata: (event.metadata ?? null) as any
      }
    }).catch(() => { /* non-fatal */ });
  }
};

// ── Oracle runtime adapter ───────────────────────────────────────────────────
// Opens one persistent connection at startup for all runtime requests.

const runtimeAdapter = createOracleConnectorAdapter(oracledb);
await runtimeAdapter.openConnection({
  user: requiredEnv("ORACLE_USER"),
  password: process.env.ORACLE_PASSWORD,
  host: process.env.ORACLE_HOST,
  port: process.env.ORACLE_PORT ? Number(process.env.ORACLE_PORT) : undefined,
  serviceName: process.env.ORACLE_SERVICE_NAME,
  sid: process.env.ORACLE_SID,
  connectString: process.env.ORACLE_CONNECT_STRING
});

// ── Oracle bind types (real oracledb constants) ──────────────────────────────

const oracleBindTypes = {
  string:    oracledb.STRING,
  number:    oracledb.NUMBER,
  date:      oracledb.DATE,
  timestamp: oracledb.TIMESTAMP,
  cursor:    oracledb.CURSOR,
  buffer:    oracledb.BUFFER,
  clob:      oracledb.CLOB,
  blob:      oracledb.BLOB
};

// ── Services ─────────────────────────────────────────────────────────────────

const adapterFactory = () => createOracleConnectorAdapter(oracledb);
const resolvePassword = () => process.env.ORACLE_PASSWORD;

const connections = createOracleConnectionRegistry(prisma as any);
const compiler    = createOracleAwareContractCompiler(prisma as any);
const inspector   = createOracleSchemaInspector({ store: prisma as any, adapterFactory, resolvePassword });
const capabilityDetector = createOracleCapabilityDetector({ store: prisma as any, adapterFactory, resolvePassword });
const drafts    = createDraftContractService(prisma as any, audit);
const publisher = createContractPublishService(prisma as any, compiler, audit);
const cache     = createContractCache(prisma as any);

// ── Admin store adapter (maps prisma delegates to BridgeAdminStore) ───────────

const store: BridgeHttpContext["store"] = {
  oracleSchemaSnapshot: prisma.oracleSchemaSnapshot as any,
  publishedContract:    prisma.publishedContract as any,
  compilerDiagnostic:   prisma.compilerDiagnostic as any,
  auditLog: {
    findMany: (args) => prisma.apiAuditLog.findMany({
      where: args?.where ? { eventType: args.where.eventType } : undefined,
      orderBy: args?.orderBy,
      take: args?.take
    }) as any
  }
};

// ── Context ──────────────────────────────────────────────────────────────────

const ctx: BridgeHttpContext = {
  connections,
  inspector,
  capabilityDetector,
  drafts,
  publisher,
  compiler,
  cache,
  adapter: runtimeAdapter,
  permissions: createPermissiveChecker(),
  oracleBindTypes,
  audit,
  store
};

// ── Boot ─────────────────────────────────────────────────────────────────────

await cache.loadActiveContracts();

const port = Number(process.env.PORT ?? 3000);
const app  = createApp(ctx, { adminApiKey: requiredEnv("ADMIN_API_KEY") });

app.listen(port, () => {
  console.log(`Bridge API listening on port ${port}`);
});
