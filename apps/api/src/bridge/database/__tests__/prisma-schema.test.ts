import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(testDir, "../../../..");
const schema = readFileSync(resolve(apiRoot, "prisma/schema.prisma"), "utf8");
const prismaConfig = readFileSync(resolve(apiRoot, "prisma.config.ts"), "utf8");
const migrationsDir = resolve(apiRoot, "prisma/migrations");
const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(migrationsDir, entry.name, "migration.sql"))
      .filter((migrationPath) => existsSync(migrationPath))
  : [];
const migrations = migrationFiles.map((migrationPath) => readFileSync(migrationPath, "utf8")).join("\n");
const migrationIt = migrationFiles.length > 0 ? it : it.skip;

const requiredTables = [
  "api_connections",
  "oracle_schema_snapshots",
  "api_contract_drafts",
  "published_contracts",
  "api_contract_versions",
  "contract_publish_history",
  "compiler_diagnostics",
  "api_audit_logs",
  "schema_drift_reports",
  "bridge_tenants",
  "bridge_tenant_connections",
  "bridge_user_tenant_access"
];

describe("Bridge operational metadata schema", () => {
  it("defines every required metadata table in Prisma", () => {
    for (const tableName of requiredTables) {
      expect(schema).toContain(`@@map("${tableName}")`);
    }
  });

  migrationIt("creates every required metadata table in the migration", () => {
    for (const tableName of requiredTables) {
      expect(migrations).toContain(`CREATE TABLE "${tableName}"`);
    }
  });

  it("stores compiled published contracts in JSONB-compatible contract_data", () => {
    expect(schema).toContain('contractData     Json                     @map("contract_data") @db.JsonB');
  });

  it("keeps the operational database URL in Prisma config", () => {
    expect(schema).not.toContain("url      = env(");
    expect(prismaConfig).toContain("DATABASE_URL");
    expect(prismaConfig).toContain("postgresql://postgres:mysecretpassword@localhost:5432/postgres");
  });

  it("defines the required published contract indexes in Prisma", () => {
    expect(schema).toContain("@@index([status])");
    expect(schema).toContain("@@index([endpointPath])");
    expect(schema).toContain("@@index([oracleOwner, oracleObjectName])");
    expect(schema).toContain(
      '@@index([contractData], type: Gin, map: "published_contracts_contract_data_gin_idx")'
    );
  });

  migrationIt("adds the required published contract indexes in the migration", () => {
    expect(migrations).toContain('CREATE INDEX "published_contracts_status_idx"');
    expect(migrations).toContain('CREATE INDEX "published_contracts_endpoint_path_idx"');
    expect(migrations).toContain(
      'CREATE INDEX "published_contracts_oracle_owner_oracle_object_name_idx"'
    );
    expect(migrations).toContain('ON "published_contracts" USING GIN ("contract_data")');
  });

  // ── Phase 9c — Tenant-aware contract publishing ────────────────────────────

  it("defines tenant_id column on published_contracts in Prisma", () => {
    expect(schema).toContain('tenantId         String?                  @map("tenant_id") @db.Uuid');
  });

  it("defines api_connection_id column on published_contracts in Prisma", () => {
    expect(schema).toContain('apiConnectionId  String?                  @map("api_connection_id") @db.Uuid');
  });

  it("defines scoped uniqueness on published_contracts in Prisma", () => {
    expect(schema).toContain("@@unique([tenantId, apiConnectionId, endpointPath, version])");
  });

  it("defines tenant+connection+endpoint index on published_contracts in Prisma", () => {
    expect(schema).toContain("@@index([tenantId, apiConnectionId, endpointPath])");
  });

  it("defines tenant+connection+status index on published_contracts in Prisma", () => {
    expect(schema).toContain("@@index([tenantId, apiConnectionId, status])");
  });

  it("defines tenant+connection+oracle index on published_contracts in Prisma", () => {
    expect(schema).toContain("@@index([tenantId, apiConnectionId, oracleOwner, oracleObjectName])");
  });

  it("defines BridgeTenant → PublishedContract reverse relation in Prisma", () => {
    expect(schema).toContain("publishedContracts PublishedContract[]");
  });

  migrationIt("adds tenant_id column to published_contracts in migration SQL", () => {
    expect(migrations).toContain('ALTER TABLE "published_contracts" ADD COLUMN "tenant_id" UUID');
  });

  migrationIt("adds api_connection_id column to published_contracts in migration SQL", () => {
    expect(migrations).toContain('ALTER TABLE "published_contracts" ADD COLUMN "api_connection_id" UUID');
  });

  migrationIt("drops old global uniqueness constraints for published_contracts in migration SQL", () => {
    expect(migrations).toContain('"published_contracts_resource_name_version_key"');
    expect(migrations).toContain('"published_contracts_endpoint_path_version_key"');
  });

  migrationIt("adds scoped uniqueness index on published_contracts in migration SQL", () => {
    expect(migrations).toContain('"published_contracts_tenant_conn_endpoint_version_key"');
  });

  migrationIt("adds tenant+connection+endpoint index on published_contracts in migration SQL", () => {
    expect(migrations).toContain('"published_contracts_tenant_conn_endpoint_idx"');
  });

  migrationIt("adds tenant+connection+status index on published_contracts in migration SQL", () => {
    expect(migrations).toContain('"published_contracts_tenant_conn_status_idx"');
  });

  migrationIt("adds tenant+connection+oracle index on published_contracts in migration SQL", () => {
    expect(migrations).toContain('"published_contracts_tenant_conn_oracle_idx"');
  });

  migrationIt("adds FK from published_contracts to bridge_tenants in migration SQL", () => {
    expect(migrations).toContain('"published_contracts_tenant_id_fkey"');
    expect(migrations).toContain('REFERENCES "bridge_tenants"("id")');
  });

  migrationIt("adds FK from published_contracts to api_connections in migration SQL", () => {
    expect(migrations).toContain('"published_contracts_api_connection_id_fkey"');
  });

  it("defines unique connection names in Prisma", () => {
    expect(schema).toContain("@@unique([name])");
  });

  migrationIt("adds unique indexes for connection names and Oracle endpoint identity", () => {
    expect(migrations).toContain('CREATE UNIQUE INDEX "api_connections_name_key"');
    expect(migrations).toContain('CREATE UNIQUE INDEX "api_connections_service_name_endpoint_key"');
    expect(migrations).toContain("WHERE \"connection_type\" = 'serviceName'");
    expect(migrations).toContain('CREATE UNIQUE INDEX "api_connections_sid_endpoint_key"');
    expect(migrations).toContain("WHERE \"connection_type\" = 'sid'");
    expect(migrations).toContain('CREATE UNIQUE INDEX "api_connections_tns_alias_endpoint_key"');
    expect(migrations).toContain("WHERE \"connection_type\" = 'tnsAlias'");
    expect(migrations).toContain('CREATE UNIQUE INDEX "api_connections_wallet_endpoint_key"');
    expect(migrations).toContain("WHERE \"connection_type\" = 'wallet'");
  });

  // ── Tenant metadata (Phase 9a/9b) ─────────────────────────────────────────

  it("defines BridgeTenant model with required fields in Prisma", () => {
    expect(schema).toContain('@@map("bridge_tenants")');
    expect(schema).toContain("code        String                   @unique");
    expect(schema).toContain("@@index([status])");
  });

  it("defines BridgeTenantConnection model with tenant relation and unique constraint in Prisma", () => {
    expect(schema).toContain('@@map("bridge_tenant_connections")');
    expect(schema).toContain("@@unique([tenantId, apiConnectionId])");
  });

  it("defines BridgeUserTenantAccess model with unique user+tenant constraint in Prisma", () => {
    expect(schema).toContain('@@map("bridge_user_tenant_access")');
    expect(schema).toContain("@@unique([userId, tenantId])");
  });

  migrationIt("creates tenant tables in migration SQL", () => {
    expect(migrations).toContain('CREATE TABLE "bridge_tenants"');
    expect(migrations).toContain('CREATE TABLE "bridge_tenant_connections"');
    expect(migrations).toContain('CREATE TABLE "bridge_user_tenant_access"');
  });

  migrationIt("adds unique tenant code index in migration SQL", () => {
    expect(migrations).toContain('CREATE UNIQUE INDEX "bridge_tenants_code_key"');
  });

  migrationIt("adds partial alias uniqueness index in migration SQL", () => {
    expect(migrations).toContain('"bridge_tenant_connections_tenant_id_alias_key"');
    expect(migrations).toContain('WHERE "alias" IS NOT NULL');
  });

  migrationIt("adds tenant FK constraints in migration SQL", () => {
    expect(migrations).toContain('"bridge_tenant_connections_tenant_id_fkey"');
    expect(migrations).toContain('"bridge_user_tenant_access_tenant_id_fkey"');
  });

  migrationIt("adds api_connection FK from bridge_tenant_connections in migration SQL", () => {
    expect(migrations).toContain('"bridge_tenant_connections_api_connection_id_fkey"');
  });
});
