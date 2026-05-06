-- CreateTable
CREATE TABLE "api_connections" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "oracle_owner" VARCHAR(100),
    "connection_mode" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'unverified',
    "config_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oracle_schema_snapshots" (
    "id" UUID NOT NULL,
    "api_connection_id" UUID NOT NULL,
    "oracle_owner" VARCHAR(100) NOT NULL,
    "snapshot_data" JSONB NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captured_by" VARCHAR(100),

    CONSTRAINT "oracle_schema_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_contract_drafts" (
    "id" UUID NOT NULL,
    "api_connection_id" UUID NOT NULL,
    "resource_name" VARCHAR(100) NOT NULL,
    "endpoint_path" VARCHAR(255) NOT NULL,
    "draft_data" JSONB NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "created_by" VARCHAR(100),
    "updated_by" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_contract_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_contracts" (
    "id" UUID NOT NULL,
    "resource_name" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL,
    "endpoint_path" VARCHAR(255) NOT NULL,
    "contract_data" JSONB NOT NULL,
    "oracle_owner" VARCHAR(100),
    "oracle_object_name" VARCHAR(100),
    "oracle_object_type" VARCHAR(50),
    "status" VARCHAR(30) NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "published_by" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "published_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_contract_versions" (
    "id" UUID NOT NULL,
    "api_contract_draft_id" UUID NOT NULL,
    "published_contract_id" UUID,
    "version" INTEGER NOT NULL,
    "version_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(100),

    CONSTRAINT "api_contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_publish_history" (
    "id" UUID NOT NULL,
    "published_contract_id" UUID NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "actor" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_publish_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compiler_diagnostics" (
    "id" UUID NOT NULL,
    "api_contract_draft_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "severity" VARCHAR(30) NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compiler_diagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_audit_logs" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "actor" VARCHAR(100),
    "request_id" VARCHAR(100),
    "resource_name" VARCHAR(100),
    "endpoint_path" VARCHAR(255),
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schema_drift_reports" (
    "id" UUID NOT NULL,
    "published_contract_id" UUID NOT NULL,
    "severity" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'open',
    "report_data" JSONB NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "schema_drift_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_connections_status_idx" ON "api_connections"("status");

-- CreateIndex
CREATE INDEX "oracle_schema_snapshots_api_connection_id_idx" ON "oracle_schema_snapshots"("api_connection_id");

-- CreateIndex
CREATE INDEX "oracle_schema_snapshots_oracle_owner_idx" ON "oracle_schema_snapshots"("oracle_owner");

-- CreateIndex
CREATE INDEX "api_contract_drafts_api_connection_id_idx" ON "api_contract_drafts"("api_connection_id");

-- CreateIndex
CREATE INDEX "api_contract_drafts_status_idx" ON "api_contract_drafts"("status");

-- CreateIndex
CREATE INDEX "api_contract_drafts_endpoint_path_idx" ON "api_contract_drafts"("endpoint_path");

-- CreateIndex
CREATE INDEX "published_contracts_status_idx" ON "published_contracts"("status");

-- CreateIndex
CREATE INDEX "published_contracts_endpoint_path_idx" ON "published_contracts"("endpoint_path");

-- CreateIndex
CREATE INDEX "published_contracts_oracle_owner_oracle_object_name_idx" ON "published_contracts"("oracle_owner", "oracle_object_name");

-- CreateIndex
CREATE INDEX "published_contracts_contract_data_gin_idx" ON "published_contracts" USING GIN ("contract_data");

-- CreateIndex
CREATE UNIQUE INDEX "published_contracts_resource_name_version_key" ON "published_contracts"("resource_name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "published_contracts_endpoint_path_version_key" ON "published_contracts"("endpoint_path", "version");

-- CreateIndex
CREATE INDEX "api_contract_versions_api_contract_draft_id_idx" ON "api_contract_versions"("api_contract_draft_id");

-- CreateIndex
CREATE INDEX "api_contract_versions_published_contract_id_idx" ON "api_contract_versions"("published_contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_contract_versions_api_contract_draft_id_version_key" ON "api_contract_versions"("api_contract_draft_id", "version");

-- CreateIndex
CREATE INDEX "contract_publish_history_published_contract_id_idx" ON "contract_publish_history"("published_contract_id");

-- CreateIndex
CREATE INDEX "contract_publish_history_action_idx" ON "contract_publish_history"("action");

-- CreateIndex
CREATE INDEX "compiler_diagnostics_api_contract_draft_id_idx" ON "compiler_diagnostics"("api_contract_draft_id");

-- CreateIndex
CREATE INDEX "compiler_diagnostics_severity_idx" ON "compiler_diagnostics"("severity");

-- CreateIndex
CREATE INDEX "api_audit_logs_event_type_idx" ON "api_audit_logs"("event_type");

-- CreateIndex
CREATE INDEX "api_audit_logs_request_id_idx" ON "api_audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "api_audit_logs_resource_name_idx" ON "api_audit_logs"("resource_name");

-- CreateIndex
CREATE INDEX "api_audit_logs_occurred_at_idx" ON "api_audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "schema_drift_reports_published_contract_id_idx" ON "schema_drift_reports"("published_contract_id");

-- CreateIndex
CREATE INDEX "schema_drift_reports_severity_idx" ON "schema_drift_reports"("severity");

-- CreateIndex
CREATE INDEX "schema_drift_reports_status_idx" ON "schema_drift_reports"("status");

-- CreateIndex
CREATE INDEX "schema_drift_reports_checked_at_idx" ON "schema_drift_reports"("checked_at");

-- AddForeignKey
ALTER TABLE "oracle_schema_snapshots" ADD CONSTRAINT "oracle_schema_snapshots_api_connection_id_fkey" FOREIGN KEY ("api_connection_id") REFERENCES "api_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_contract_drafts" ADD CONSTRAINT "api_contract_drafts_api_connection_id_fkey" FOREIGN KEY ("api_connection_id") REFERENCES "api_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_contract_versions" ADD CONSTRAINT "api_contract_versions_api_contract_draft_id_fkey" FOREIGN KEY ("api_contract_draft_id") REFERENCES "api_contract_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_contract_versions" ADD CONSTRAINT "api_contract_versions_published_contract_id_fkey" FOREIGN KEY ("published_contract_id") REFERENCES "published_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_publish_history" ADD CONSTRAINT "contract_publish_history_published_contract_id_fkey" FOREIGN KEY ("published_contract_id") REFERENCES "published_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compiler_diagnostics" ADD CONSTRAINT "compiler_diagnostics_api_contract_draft_id_fkey" FOREIGN KEY ("api_contract_draft_id") REFERENCES "api_contract_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schema_drift_reports" ADD CONSTRAINT "schema_drift_reports_published_contract_id_fkey" FOREIGN KEY ("published_contract_id") REFERENCES "published_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
