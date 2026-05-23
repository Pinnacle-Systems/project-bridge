-- AlterTable
ALTER TABLE "oracle_schema_snapshots" ADD COLUMN     "content_hash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "oracle_schema_snapshots_api_connection_id_oracle_owner_cont_idx" ON "oracle_schema_snapshots"("api_connection_id", "oracle_owner", "content_hash");
