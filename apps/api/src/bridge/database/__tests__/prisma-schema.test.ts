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
  "schema_drift_reports"
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
});
