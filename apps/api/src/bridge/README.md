# Pluggable API / Oracle Legacy API Bridge

Contract-driven REST APIs over legacy Oracle databases. Define explicit field mappings, publish contracts, and expose safe, audited endpoints — without writing boilerplate CRUD.

---

## 1. What this module does

- Accepts an explicit **contract definition** describing how Oracle tables, views, packages, or procedures map to a REST API.
- **Compiles** the draft against a live Oracle schema snapshot to catch type mismatches and missing columns before anything is published.
- **Publishes** the compiled contract and loads it into an in-process cache.
- **Dispatches** incoming `/api/*` HTTP requests to the correct Oracle query or PL/SQL call based solely on the published contract.
- **Detects drift** between a published contract and the current Oracle schema on demand.
- **Retires** contracts, immediately removing them from runtime resolution.

---

## 2. What this module does NOT do

| Not implemented | Notes |
| --- | --- |
| Auto-CRUD from table name | Every field, operation, and type mapping must be declared explicitly in the contract |
| Admin UI | Contract lifecycle is managed entirely through the REST admin API |
| Scheduled drift detection | Drift is checked on demand only (`POST /bridge/contracts/published/:id/check-drift`) |
| DELETE runtime support | DELETE operations are recognised in contracts but return 405 at runtime in the current MVP |
| Safe includes / joins | Multi-table joins are not supported; model them in an Oracle view instead |
| Connection pooling | The runtime uses a single persistent Oracle connection opened at startup |
| JWT/OIDC auth | The runtime validates identity using a `PrincipalProvider`; the stub provider reads headers — wire a real JWT/OIDC provider for production |

---

## 3. Current MVP capabilities

- **Table/view read** — `GET /api/{endpoint}` (list) and `GET /api/{endpoint}/{id}` (single record)
- **Package/procedure read via SYS_REFCURSOR** — `GET /api/{endpoint}` calls a procedure and streams the cursor
- **Package/procedure write** — `POST /api/{endpoint}` (create) and `PUT|PATCH /api/{endpoint}` (update)
- **Direct table write** — `POST /api/{endpoint}` and `PATCH /api/{endpoint}/{id}` execute parameterised INSERT/UPDATE without a procedure layer
- **Filtering** — `?filter[field]=value` (eq operator) for table/view contracts
- **Sorting** — `?sort[field]=asc|desc` for table/view contracts
- **Pagination** — `?limit=N&offset=N` with contract-level `maxLimit` enforcement; both OFFSET/FETCH and ROWNUM strategies supported
- **CHAR trimRight** — auto-applied at compile time; trailing spaces are stripped on reads
- **Boolean mapping** — CHAR(1) Y/N and NUMBER(1) 0/1 ↔ JSON true/false via `booleanMapping` transformer
- **DATE/TIMESTAMP** — normalised to ISO 8601 strings on reads; ISO strings converted to `Date` objects on writes
- **Optimistic locking** — version-column or timestamp-column locking for both direct-table and procedure-backed updates
- **Audit logging** — every runtime request, Oracle error, schema mismatch, and optimistic-lock conflict is written to `api_audit_logs`
- **Oracle error translation** — ORA codes mapped to typed API errors; raw Oracle messages are never returned to callers
- **Tenant-scoped runtime dispatch** — every `/api/*` request must authenticate and resolve a tenant; contracts are keyed by `tenantId + apiConnectionId + method + endpointPath`; the legacy path-only lookup is not used at runtime

---

## 4. Architecture overview

```text
HTTP request
    │
    ├─ /bridge/*  ── AdminAuthMiddleware ──► AdminRouter ──► AdminHandlers
    │                                                              │
    │                                          connections / inspector / compiler
    │                                          drafts / publisher / cache mgmt
    │
    └─ /api/*  ─────────────────────────────► BridgeRouter
                                                   │
                                         ContractCache.getContractByEndpoint()
                                                   │
                        ┌──────────────────────────┼──────────────────────────┐
                        │                           │                          │
                   ReadHandler               WriteHandler            CursorReadHandler
                   DirectWriteHandler
                        │                           │                          │
                   QueryBuilder              OracleConnectorAdapter      OracleConnectorAdapter
                   (SELECT)                 (BEGIN pkg.proc; END;)      (BEGIN pkg.proc; END;)
                        │                                                       │
                   OracleConnectorAdapter                              SYS_REFCURSOR iteration
                        │
                   TransformerEngine ── AuditLogger ── ErrorTranslator
```

**Key boundaries:**

- Admin plane (`/bridge/*`) is protected by `x-admin-api-key`. Runtime plane (`/api/*`) is not — plug in your own auth via `PermissionChecker`.
- Draft contracts are **never** executed. Only `status = "active"` published contracts are loaded into the runtime cache.
- Contracts in the cache are validated against the current schema version on load. Invalid or schema-version-mismatch contracts are skipped with a warning.

---

## 5. Runtime flow (per request)

1. `BridgeRouter` resolves the path — tries exact match first, then strips the last segment as an ID.
2. `ContractCache.getContractByEndpoint(method, path)` returns the `ResolvedApiContract` or 404.
3. The matching operation policy is located (`read`, `list`, `create`, `update`). If disabled → 405.
4. Permission check via `PermissionChecker` (default: permissive). Fails → 403.
5. Dispatch to the appropriate handler based on contract type and operation mode:
   - `sysRefCursor` present on a GET → `CursorReadHandler`
   - GET without cursor → `ReadHandler` → `QueryBuilder` → parameterised SELECT
   - POST/PUT/PATCH with `mode: "direct_table"` → `DirectWriteHandler` → parameterised INSERT/UPDATE
   - POST/PUT/PATCH with package/procedure source → `WriteHandler` → `BEGIN pkg.proc(...); END;`
6. Oracle response is mapped through `TransformerEngine` (type normalisation, trimRight, booleanMapping).
7. `readOnly` fields are excluded from write responses; `writeOnly` fields are excluded from reads.
8. Oracle errors are translated — raw ORA messages are never forwarded.
9. Audit log is written (fire-and-forget, non-fatal).

---

## 6. Admin flow (contract lifecycle)

```text
POST /bridge/connections            Create an Oracle connection record
POST /bridge/connections/:id/test   Verify connectivity + detect Oracle capabilities
POST /bridge/connections/:id/inspect  Snapshot the schema for an owner
GET  /bridge/schema-snapshots/:id/objects          Browse tables/views
GET  /bridge/schema-snapshots/:id/program-units    Browse packages/procedures

POST /bridge/compiler/validate      Validate a draft contract (does not persist)
POST /bridge/contracts/drafts       Persist a draft
POST /bridge/contracts/drafts/:id/publish  Compile + publish → loads into cache

GET  /bridge/contracts/published             List active published contracts
POST /bridge/contracts/published/:id/check-drift  On-demand drift check
POST /bridge/contracts/published/:id/retire  Retire + evict from runtime cache

POST /bridge/cache/reload           Hot-reload all active contracts from DB
```

All admin endpoints require the `x-admin-api-key: <ADMIN_API_KEY>` header.

---

## 7. Environment setup

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for bridge metadata |
| `ADMIN_API_KEY` | Secret for all `/bridge/*` admin endpoints |
| `PORT` | HTTP server port (default: 3000) |
| `ORACLE_USER` | Oracle username for the runtime connection |
| `ORACLE_PASSWORD` | Oracle password for the runtime connection |
| `ORACLE_HOST` | Oracle host (service name / SID mode) |
| `ORACLE_PORT` | Oracle port (default: 1521) |
| `ORACLE_SERVICE_NAME` | Service name (use instead of SID for modern Oracle) |
| `ORACLE_SID` | SID (older single-instance databases) |
| `ORACLE_CONNECT_STRING` | Full TNS string (overrides host/port/service) |
| `ORACLE_DRIVER_MODE` | `thin` (default, no client libs) or `thick` |
| `ORACLE_CLIENT_LIB_DIR` | Path to Instant Client (thick mode only) |

The runtime Oracle connection is opened once at startup. Admin-plane inspection operations open short-lived connections using per-`ApiConnection` credentials stored in the database.

---

## 8. Prisma setup / migrations

```bash
# Install dependencies
pnpm install

# Generate Prisma client from schema
pnpm --filter @project-bridge/api db:generate

# Apply migrations (development)
pnpm --filter @project-bridge/api db:migrate

# Apply migrations (CI / production)
pnpm --filter @project-bridge/api db:migrate:deploy
```

The schema is in `apps/api/prisma/schema.prisma`. Core tables:

| Table | Purpose |
| --- | --- |
| `api_connections` | Oracle connection registry |
| `oracle_schema_snapshots` | Cached Oracle schema snapshots (JSON) |
| `api_contract_drafts` | Draft contract definitions |
| `published_contracts` | Published + compiled contracts; runtime reads from here |
| `api_contract_versions` | Immutable version history |
| `contract_publish_history` | Publish / retire audit trail |
| `compiler_diagnostics` | Compile-time warnings and errors |
| `schema_drift_reports` | On-demand drift check results |
| `api_audit_logs` | Runtime request and error audit log |

---

## 9. Golden-path API flow

See `test.rest` at the project root for copy-paste requests covering the complete flow. The abbreviated sequence:

1. **Create connection** — `POST /bridge/connections`
1. **Test connection** — `POST /bridge/connections/:id/test`
1. **Inspect schema** — `POST /bridge/connections/:id/inspect` with `{ "owner": "HRMS_OWNER" }`
1. **Browse snapshot** — `GET /bridge/schema-snapshots/:id/objects`
1. **Create draft** — `POST /bridge/contracts/drafts` with `{ apiConnectionId, contract: <DraftApiContract> }`
1. **Validate draft** — `POST /bridge/compiler/validate` (dry-run, does not persist)
1. **Publish draft** — `POST /bridge/contracts/drafts/:id/publish` with `{ publishedBy: "you" }`
1. **Reload cache** — `POST /bridge/cache/reload` (or restart the server)
1. **Invoke runtime** — `GET /api/employees`, `GET /api/employees/123`, `POST /api/employees`
1. **Check drift** — `POST /bridge/contracts/published/:id/check-drift`
1. **Retire** — `POST /bridge/contracts/published/:id/retire`

---

## 10. Contract examples

Sample contract JSON files are in `src/bridge/examples/`:

| File | Description |
| --- | --- |
| `table-read-contract.json` | Table-backed read (list + read-by-id), CHAR boolean, sorting, filtering |
| `direct-table-write-contract.json` | Direct INSERT/UPDATE without a procedure layer |
| `package-write-contract.json` | Package/procedure-backed create with OUT param |
| `sys-refcursor-read-contract.json` | Package/procedure read returning a SYS_REFCURSOR |

These files represent the `contract` field of the `POST /bridge/contracts/drafts` body.

---

## 11. Runtime invocation examples

**List (table/view):**

```text
GET /api/employees
GET /api/employees?limit=25&offset=0
GET /api/employees?filter[isActive]=true
GET /api/employees?sort[employeeName]=asc
```

**Read by ID (table/view):**

```text
GET /api/employees/1001
```

The ID is matched against the field marked `readOnly: true` in the contract (the primary key).

**Create via procedure:**

```text
POST /api/employees
Content-Type: application/json

{ "employeeCode": "EMP001", "employeeName": "Alice" }
```

**Update via direct table:**

```text
PATCH /api/employees/1001
Content-Type: application/json

{ "employeeName": "Alice Updated" }
```

**SYS_REFCURSOR read:**

```text
GET /api/employees/search
```

The procedure is called with its IN params. The SYS_REFCURSOR OUT param is iterated and the rows are mapped through the `sysRefCursor.fields` mapping.

---

## 12. Drift check and retirement

**Check drift** compares the published contract's field/procedure definitions against the current Oracle schema snapshot and writes a `schema_drift_reports` record. It does not modify the contract or the runtime cache.

```text
POST /bridge/contracts/published/:id/check-drift
```

Response:

```json
{
  "data": {
    "id": "...",
    "publishedContractId": "...",
    "status": "healthy|drifted|broken|warning",
    "severity": "...",
    "findings": [...],
    "checkedAt": "..."
  }
}
```

**Retire** marks the contract as `retired` in the database, writes a `contract_publish_history` record, and immediately evicts the contract from the runtime cache. Subsequent requests return 404.

```text
POST /bridge/contracts/published/:id/retire
{ "retiredBy": "you", "notes": "Replaced by v2" }
```

Retirement is idempotent — retiring an already-retired contract is a no-op.

---

## 13. Safety boundaries

| Boundary | How it is enforced |
| --- | --- |
| Only active contracts are served | Cache loads `WHERE status = 'active'`; retired/deprecated are excluded |
| Draft contracts are never executed | Runtime resolves only from `publishedContract` table |
| Unknown API fields are rejected on writes | Checked before any DB interaction in all write handlers |
| `readOnly` fields rejected on writes | Enforced in `WriteHandler` and `DirectWriteHandler` |
| `writeOnly` fields excluded from reads | `ReadHandler` and `CursorReadHandler` filter before mapping |
| Unmapped Oracle columns are not returned | Reads iterate contract `fields`, not raw result keys |
| All SQL uses bind variables | `QueryBuilder` uses `:bindKey`; PL/SQL blocks use named bind params |
| No user-supplied SQL | PL/SQL blocks are constructed from structured contract fields only |
| Oracle errors are translated | `translateOracleError` maps ORA codes to fixed vocabulary; raw messages are not forwarded |
| Schema mismatch surfaces as 500 | ORA-00942 / ORA-00904 / ORA-04063 / ORA-01031 all return a generic schema-mismatch body |
| Snapshot drill-down responses are slim | Raw `snapshotData` JSON is never returned from list/summary endpoints |
| Bind values are not logged | Audit log metadata contains operation context only, never bind parameter values |

---

## 14. Known MVP limitations

- **Single runtime Oracle connection** — no pool, no reconnect on connection loss.
- **DELETE is unsupported** — DELETE-enabled operation policies are accepted by the contract schema but return 405 at runtime.
- **GET-by-id field name** — the primary key field is resolved as the first `readOnly` field in the contract. Ensure the PK field is marked `readOnly: true`.
- **Cursor row key casing** — SYS_REFCURSOR row mapping uses `dbColumn` for key lookup. The Oracle driver returns column names in UPPERCASE by default; `dbColumn` values in contracts are normalised to uppercase for comparison.
- **No connection pool** — the admin inspector opens one connection per inspection request; this is acceptable for low-frequency admin operations.
- **No pagination on procedure-backed reads** — SYS_REFCURSOR reads are bounded by `pagination.maxLimit` (default 1000); OFFSET/FETCH is not applicable.
- **Drift check requires a recent snapshot** — if no snapshot exists for the contract's owner, the drift check returns 422.
- **Auth is permissive by default** — `createPermissiveChecker()` is wired at startup. Replace with a real implementation before production use.
- **Runtime tenant resolution not enforced yet** — The runtime cache is now tenant-scoped internally (Phase 9d), but incoming `/api/*` requests are not yet required to carry tenant identity. The HTTP router still uses the legacy cache path until Phase 9e wires request-header tenant resolution. Do not begin multi-database runtime testing until Phase 9e is implemented.

---

## 15a. Phase 9a/9b — Auth Foundation and Tenant Metadata (added 2026-06-04)

This release adds the tenant metadata store and authentication foundation required before multi-database testing. It does **not** change published contract scoping, the runtime cache key, or the runtime request lifecycle.

### What was added

| Area | What changed |
| --- | --- |
| Prisma models | `bridge_tenants`, `bridge_tenant_connections`, `bridge_user_tenant_access` |
| Tenant admin APIs | CRUD under `/bridge/tenants/*` |
| `Principal` type | `userId`, `username?`, `roles`, `tenantIds`, `permissions` |
| `PrincipalProvider` interface | `resolvePrincipal(req): Principal \| null` |
| `StubPrincipalProvider` | Reads identity from `x-bridge-user-id`, `x-bridge-tenant-id`, `x-bridge-roles`, `x-bridge-permissions` headers |
| `TenantResolver` | Helper for Phase 9e; resolves `tenantId + apiConnectionId` from a principal |

### What was intentionally NOT changed

- `published_contracts` has no `tenant_id` or `api_connection_id` columns yet (Phase 9c)
- Runtime cache key is still `method + endpointPath` (Phase 9d)
- Runtime requests are not yet authenticated (Phase 9e)
- Multi-database testing is still blocked

### Tenant setup flow

After running migrations (`pnpm --filter @project-bridge/api db:migrate:deploy`):

```text
1. POST /bridge/tenants                           — create a tenant
2. POST /bridge/tenants/:id/connections           — assign an Oracle connection to the tenant
3. POST /bridge/tenants/:id/users                 — assign a user to the tenant
```

See the `# TENANTS` section in `test.rest` for copy-paste request examples.

### Headers used by StubPrincipalProvider (internal/dev only)

| Header | Purpose |
| --- | --- |
| `x-bridge-user-id` | Required; identifies the calling user |
| `x-bridge-username` | Optional display name |
| `x-bridge-tenant-id` | Comma-separated tenant IDs the principal claims |
| `x-bridge-roles` | Comma-separated roles |
| `x-bridge-permissions` | Comma-separated permission strings |

The stub provider does **not** validate a JWT. Do not expose it on public endpoints.

---

## 15b. Phase 9c — Tenant-aware Contract Publishing (added 2026-06-05)

This release scopes every published contract to a tenant + Oracle connection pair. It does **not** change the runtime cache key or the runtime request lifecycle (those are Phase 9d/9e).

### What was added

| Area | What changed |
| --- | --- |
| Prisma schema | `published_contracts` gains nullable `tenant_id` and `api_connection_id` columns |
| Uniqueness | Global `(resource_name, version)` and `(endpoint_path, version)` constraints replaced by `(tenant_id, api_connection_id, endpoint_path, version)` |
| New indexes | Scoped lookup: `(tenant_id, api_connection_id, endpoint_path)`, `(…, status)`, `(…, oracle_owner, oracle_object_name)` |
| Compiler | Validates tenant exists, is active, and connection is assigned to tenant when `store.bridgeTenant` is wired |
| Publish API | `POST /bridge/contracts/drafts/:id/publish` now requires `tenantId` and `apiConnectionId` in the body |
| Version sequencing | Version numbers are independent per `tenantId + apiConnectionId + resourceName` |
| Deprecation scope | Deprecating a previous active contract is scoped to the same `tenantId + apiConnectionId + endpointPath`; tenant B's contract is never deprecated by tenant A's publish |
| `resolved.runtime` | `tenantId` is now embedded in every newly compiled contract |

### What was intentionally NOT changed

- Runtime cache key was still `method + endpointPath` at this phase (fixed in Phase 9d — see below)
- Runtime requests are not yet authenticated (Phase 9e)
- Multi-database runtime testing is still blocked

### Updated publish flow

After running migrations, the full publish flow is:

```text
1. POST /bridge/tenants                           — create tenant
2. POST /bridge/tenants/:id/connections           — assign Oracle connection (isDefault: true)
3. POST /bridge/connections                       — create Oracle connection (if not done)
4. POST /bridge/contracts/drafts                  — create draft
5. POST /bridge/contracts/drafts/:id/publish      — publish with tenantId + apiConnectionId
```

Updated publish body (tenantId and apiConnectionId are now required):

```json
{
  "publishedBy": "your-name",
  "tenantId": "<tenant-uuid>",
  "apiConnectionId": "<oracle-connection-uuid>",
  "changeReason": "Initial publish"
}
```

### Backward compatibility

Existing published contracts in the database retain `tenant_id = NULL` and `api_connection_id = NULL`. They remain readable and cacheable. The PostgreSQL unique index treats NULLs as distinct, so legacy rows do not conflict with each other or with new tenant-scoped rows. All **new** publishes must supply `tenantId`.

---

## 15c. Phase 9d — Scoped Runtime Cache (added 2026-06-05)

This release makes the runtime contract cache internally tenant-scoped. Incoming HTTP requests are **not yet** required to carry tenant identity (that is Phase 9e).

### What was added

| Area | What changed |
| --- | --- |
| Cache key | Changed from `METHOD:endpointPath` to `tenantId:apiConnectionId:METHOD:endpointPath` for scoped contracts |
| Two cache maps | `scopedMap` (tenant+connection keyed) and `legacyMap` (path-only, backward compat) live side-by-side |
| `getContractByScopedEndpoint` | New method on `ContractCache`; requires `tenantId + apiConnectionId + method + endpointPath` |
| `getContractByEndpoint` | Retained as legacy path; resolves from `legacyMap` only |
| `loadActiveContracts` | Scoped contracts (with `tenantId + apiConnectionId`) → `scopedMap`; legacy unscoped → `legacyMap` |
| `reloadContract` | Evicts from both maps; reindexes under correct map based on tenant scoping |
| `BridgeDispatchInput` | Optional `tenantId` and `apiConnectionId` fields (Option B); dispatcher uses scoped lookup when both present |
| Tests | 10 new cache isolation tests; 4 new dispatcher scoped tests |

### What was intentionally NOT changed

- Runtime HTTP router (`/api/*`) still uses legacy path lookup — no tenant headers required yet (Phase 9e)
- Authentication is not enforced on `/api/*` (Phase 9e)
- Multi-database live runtime testing is still blocked (Phase 9e)
- No Oracle business data was mutated; no runtime writes were run

### Backward compatibility

Existing published contracts in the database with `tenant_id = NULL` and `api_connection_id = NULL` load into the `legacyMap` and remain accessible via `getContractByEndpoint(method, path)`. Current single-db behavior is unchanged. Scoped contracts (with both fields set) are isolated to `scopedMap` and never bleed into the legacy lookup.

### Next slice: Phase 9e — Runtime Tenant Resolution and Auth Enforcement

Phase 9e will:

- Parse `x-bridge-tenant-id` (or equivalent) from incoming `/api/*` request headers
- Resolve `tenantId + apiConnectionId` via `TenantResolver`
- Call `getContractByScopedEndpoint` in `resolveRuntimePath` and the read/write handlers
- Enforce authentication before contract dispatch
- Enable multi-database runtime testing

---

## 15. Test commands

```bash
# Run all tests
pnpm test

# Typecheck without emitting
pnpm --filter @project-bridge/api typecheck

# Watch mode (development)
pnpm --filter @project-bridge/api exec vitest

# Single file
pnpm --filter @project-bridge/api exec vitest run src/bridge/runtime/__tests__/read-handler.test.ts
```

Tests use Vitest with in-memory fakes — no Oracle or PostgreSQL connection is required to run them.
