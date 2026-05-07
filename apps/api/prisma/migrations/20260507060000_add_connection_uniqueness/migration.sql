-- Connection names are operator-facing identifiers, so keep them unique.
CREATE UNIQUE INDEX "api_connections_name_key" ON "api_connections"("name");

-- Physical Oracle endpoints are unique within each addressing mode. These are
-- partial indexes because Postgres unique constraints treat NULL values as
-- distinct, which would otherwise allow duplicate service/SID/TNS/wallet rows.
CREATE UNIQUE INDEX "api_connections_service_name_endpoint_key"
ON "api_connections"("host", "port", "service_name", "username", "default_owner")
WHERE "connection_type" = 'serviceName';

CREATE UNIQUE INDEX "api_connections_sid_endpoint_key"
ON "api_connections"("host", "port", "sid", "username", "default_owner")
WHERE "connection_type" = 'sid';

CREATE UNIQUE INDEX "api_connections_tns_alias_endpoint_key"
ON "api_connections"("tns_alias", "username", "default_owner")
WHERE "connection_type" = 'tnsAlias';

CREATE UNIQUE INDEX "api_connections_wallet_endpoint_key"
ON "api_connections"("wallet_path", "username", "default_owner")
WHERE "connection_type" = 'wallet';
