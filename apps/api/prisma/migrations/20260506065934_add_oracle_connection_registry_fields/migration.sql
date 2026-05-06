/*
  Warnings:

  - You are about to drop the column `config_data` on the `api_connections` table. All the data in the column will be lost.
  - You are about to drop the column `connection_mode` on the `api_connections` table. All the data in the column will be lost.
  - You are about to drop the column `oracle_owner` on the `api_connections` table. All the data in the column will be lost.
  - Added the required column `connection_type` to the `api_connections` table without a default value. This is not possible if the table is not empty.
  - Added the required column `username` to the `api_connections` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "api_connections" DROP COLUMN "config_data",
DROP COLUMN "connection_mode",
DROP COLUMN "oracle_owner",
ADD COLUMN     "connection_type" VARCHAR(30) NOT NULL,
ADD COLUMN     "default_owner" VARCHAR(100),
ADD COLUMN     "encrypted_password" TEXT,
ADD COLUMN     "host" VARCHAR(255),
ADD COLUMN     "oracle_version" VARCHAR(50),
ADD COLUMN     "pagination_strategy" VARCHAR(30),
ADD COLUMN     "password_secret_ref" VARCHAR(500),
ADD COLUMN     "port" INTEGER,
ADD COLUMN     "service_name" VARCHAR(255),
ADD COLUMN     "sid" VARCHAR(100),
ADD COLUMN     "tns_alias" VARCHAR(255),
ADD COLUMN     "username" VARCHAR(255) NOT NULL,
ADD COLUMN     "wallet_path" VARCHAR(500),
ADD COLUMN     "wallet_secret_ref" VARCHAR(500);

-- CreateIndex
CREATE INDEX "api_connections_connection_type_idx" ON "api_connections"("connection_type");

-- CreateIndex
CREATE INDEX "api_connections_default_owner_idx" ON "api_connections"("default_owner");
