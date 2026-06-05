-- Phase 9c: Tenant-aware contract publishing
-- Adds tenant_id and api_connection_id to published_contracts, replaces the
-- global (resource_name, version) and (endpoint_path, version) unique constraints
-- with a scoped (tenant_id, api_connection_id, endpoint_path, version) unique index.
-- NULLs are not equal in PostgreSQL unique indexes, so existing rows (tenant_id IS NULL)
-- do not conflict with each other and require no backfill.

-- Add tenant scope columns (nullable — existing rows remain valid without backfill)
ALTER TABLE "published_contracts" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "published_contracts" ADD COLUMN "api_connection_id" UUID;

-- Drop old global unique constraints that prevent multi-tenant publishing
DROP INDEX IF EXISTS "published_contracts_resource_name_version_key";
DROP INDEX IF EXISTS "published_contracts_endpoint_path_version_key";

-- Scoped uniqueness: tenant + connection + endpoint + version must be unique.
-- Two different tenants can both publish GET /currencies without conflict.
CREATE UNIQUE INDEX "published_contracts_tenant_conn_endpoint_version_key"
  ON "published_contracts" ("tenant_id", "api_connection_id", "endpoint_path", "version");

-- Scoped runtime lookup: resolve active contract for a tenant + connection + endpoint
CREATE INDEX "published_contracts_tenant_conn_endpoint_idx"
  ON "published_contracts" ("tenant_id", "api_connection_id", "endpoint_path");

-- Status filter within a tenant + connection scope (admin listing, cache load)
CREATE INDEX "published_contracts_tenant_conn_status_idx"
  ON "published_contracts" ("tenant_id", "api_connection_id", "status");

-- Oracle object lookup within a tenant + connection scope (drift check)
CREATE INDEX "published_contracts_tenant_conn_oracle_idx"
  ON "published_contracts" ("tenant_id", "api_connection_id", "oracle_owner", "oracle_object_name");

-- FK to bridge_tenants (nullable; SetNull on tenant deletion)
ALTER TABLE "published_contracts"
  ADD CONSTRAINT "published_contracts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "bridge_tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- FK to api_connections for data integrity (no Prisma-level relation needed)
ALTER TABLE "published_contracts"
  ADD CONSTRAINT "published_contracts_api_connection_id_fkey"
  FOREIGN KEY ("api_connection_id") REFERENCES "api_connections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
