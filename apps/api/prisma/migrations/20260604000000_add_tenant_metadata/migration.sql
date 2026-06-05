-- CreateTable
CREATE TABLE "bridge_tenants" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bridge_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_tenant_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "api_connection_id" UUID NOT NULL,
    "alias" VARCHAR(100),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bridge_tenant_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_user_tenant_access" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(100) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role" VARCHAR(100) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bridge_user_tenant_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bridge_tenants_code_key" ON "bridge_tenants"("code");

-- CreateIndex
CREATE INDEX "bridge_tenants_status_idx" ON "bridge_tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bridge_tenant_connections_tenant_id_api_connection_id_key"
    ON "bridge_tenant_connections"("tenant_id", "api_connection_id");

-- Partial unique index: alias must be unique per tenant when set
CREATE UNIQUE INDEX "bridge_tenant_connections_tenant_id_alias_key"
    ON "bridge_tenant_connections"("tenant_id", "alias")
    WHERE "alias" IS NOT NULL;

-- CreateIndex
CREATE INDEX "bridge_tenant_connections_tenant_id_idx" ON "bridge_tenant_connections"("tenant_id");

-- CreateIndex
CREATE INDEX "bridge_tenant_connections_api_connection_id_idx" ON "bridge_tenant_connections"("api_connection_id");

-- CreateIndex
CREATE INDEX "bridge_tenant_connections_tenant_id_is_default_idx" ON "bridge_tenant_connections"("tenant_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "bridge_user_tenant_access_user_id_tenant_id_key"
    ON "bridge_user_tenant_access"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "bridge_user_tenant_access_user_id_idx" ON "bridge_user_tenant_access"("user_id");

-- CreateIndex
CREATE INDEX "bridge_user_tenant_access_tenant_id_idx" ON "bridge_user_tenant_access"("tenant_id");

-- CreateIndex
CREATE INDEX "bridge_user_tenant_access_status_idx" ON "bridge_user_tenant_access"("status");

-- AddForeignKey
ALTER TABLE "bridge_tenant_connections" ADD CONSTRAINT "bridge_tenant_connections_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "bridge_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: references api_connections for data integrity (no Prisma-level relation needed)
ALTER TABLE "bridge_tenant_connections" ADD CONSTRAINT "bridge_tenant_connections_api_connection_id_fkey"
    FOREIGN KEY ("api_connection_id") REFERENCES "api_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_user_tenant_access" ADD CONSTRAINT "bridge_user_tenant_access_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "bridge_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
