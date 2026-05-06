# Database Migrations

Bridge operational metadata is stored in Postgres, separately from the Oracle legacy database.

## Prisma is the migration source of truth

Do not hand-generate migration SQL. Define schema changes in `apps/api/prisma/schema.prisma` first, then let Prisma create the migration SQL.

Use:

```bash
pnpm --filter @project-bridge/api db:migrate:create -- --name <migration_name>
```

Review the generated SQL before committing it, but do not rewrite it by hand unless Prisma cannot express a required Postgres feature. If a manual adjustment is unavoidable, document the reason in the migration file and in this document.

Once a migration has been applied to any database, treat that migration file as immutable. Put later changes in a new Prisma-generated migration instead of editing the existing migration file.

For local development with the Compose Postgres service:

```bash
docker compose up -d postgres
pnpm --filter @project-bridge/api db:migrate
```

For deployed environments:

```bash
pnpm --filter @project-bridge/api db:migrate:deploy
```

The `published_contracts.contract_data` JSONB GIN index is named explicitly in `schema.prisma` so Prisma-generated migrations use a stable database index name.
