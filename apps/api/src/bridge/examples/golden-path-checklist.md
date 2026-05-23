# Golden-Path MVP Smoke Checklist

Manual verification checklist for a fresh Bridge deployment. Work through each step in order — each step depends on the one before it.

## Prerequisites

- [ ] PostgreSQL is running and `DATABASE_URL` is set
- [ ] Prisma migrations have been applied: `pnpm --filter @project-bridge/api db:migrate:deploy`
- [ ] Oracle environment variables are configured (`ORACLE_USER`, `ORACLE_PASSWORD`, and one of `ORACLE_SERVICE_NAME` / `ORACLE_SID` / `ORACLE_CONNECT_STRING`)
- [ ] `ADMIN_API_KEY` is set to a non-empty value
- [ ] API server starts without error: `pnpm --filter @project-bridge/api dev`

---

## Infrastructure

- [ ] **DB migrated** — `pnpm db:migrate:deploy` exits 0; no pending migrations
- [ ] **API started** — server logs `Bridge API listening on port 3000` (or configured PORT)
- [ ] **Oracle connected** — startup does not throw `ORA-` or connection errors
- [ ] **Cache loaded** — startup completes `loadActiveContracts()` (log shows no warnings about skipped contracts on a fresh DB)

---

## Admin: Connection

- [ ] **Create connection** — `POST /bridge/connections` returns `201` with a connection UUID
  - Copy the `id` as `@connectionId`
- [ ] **Get connection** — `GET /bridge/connections/:id` returns the connection record
- [ ] **Test connection** — `POST /bridge/connections/:id/test` returns `{ success: true }` and marks the connection `active`

---

## Admin: Schema Inspection

- [ ] **Inspect schema** — `POST /bridge/connections/:id/inspect` with `{ "owner": "HRMS_OWNER" }` returns `201` with a snapshot `id`
  - Copy the `id` as `@snapshotId`
- [ ] **List snapshots** — `GET /bridge/schema-snapshots` returns the snapshot in the list
- [ ] **Get snapshot summary** — `GET /bridge/schema-snapshots/:id` returns `{ objects, sequences, programUnits }` counts
- [ ] **List objects** — `GET /bridge/schema-snapshots/:id/objects` returns table/view rows with `columnCount`
- [ ] **Get one object** — `GET /bridge/schema-snapshots/:id/objects/EMPLOYEE_MASTER` returns full column, constraint, and index details
- [ ] **List program units** — `GET /bridge/schema-snapshots/:id/program-units` returns procedures/packages
- [ ] **Get one program unit** — `GET /bridge/schema-snapshots/:id/program-units/CREATE_EMPLOYEE?package=PKG_EMPLOYEE_API` returns argument details

---

## Admin: Draft and Compile

- [ ] **Create draft** — `POST /bridge/contracts/drafts` with `{ apiConnectionId, contract: <from examples/> }` returns `201` with a draft `id`
  - Copy the `id` as `@draftId`
- [ ] **Get draft** — `GET /bridge/contracts/drafts/:id` returns the stored draft
- [ ] **Validate draft (dry-run)** — `POST /bridge/compiler/validate` with `{ apiConnectionId, contract: <draft body> }` returns `{ valid: true, diagnostics: [...] }` — no `error` severity diagnostics
- [ ] **Compile draft (persisted)** — same payload to `POST /bridge/compiler/compile` returns `{ data: <resolved contract>, diagnostics: [...] }` — runtime object includes `runtime.cacheKey` and `runtime.apiConnectionId`

---

## Admin: Publish and Cache

- [ ] **Publish draft** — `POST /bridge/contracts/drafts/:id/publish` with `{ publishedBy: "you" }` returns `201` with published contract
  - Copy the `id` as `@publishedContractId`
- [ ] **List published** — `GET /bridge/contracts/published` returns the contract with `status: "active"`
- [ ] **Reload cache** — `POST /bridge/cache/reload` returns `{ success: true }`
- [ ] **Cache status** — `GET /bridge/cache/status` returns `{ status: "ok" }`

---

## Runtime: Read Contract

- [ ] **GET list** — `GET /api/employees` returns `{ data: [...] }` with mapped field names (not raw Oracle column names)
- [ ] **GET with pagination** — `GET /api/employees?limit=5&offset=0` returns at most 5 rows
- [ ] **GET with filter** — `GET /api/employees?filter[isActive]=true` returns only active employees
- [ ] **GET with sort** — `GET /api/employees?sort[employeeName]=asc` returns alphabetically ordered rows
- [ ] **GET by id** — `GET /api/employees/1001` returns `{ data: { employeeId: 1001, ... } }` or `404`
- [ ] **Unknown endpoint** — `GET /api/nonexistent` returns `404 { error: "No contract found for this endpoint." }`

---

## Runtime: Write Contract (if write contract is published)

- [ ] **POST create (procedure)** — `POST /api/employees` with required fields returns `201 { data: { employeeId: <generated> } }`
- [ ] **POST create (direct table)** — `POST /api/employee-master` with required fields returns `201 { data: { employeeId: <generated> } }`
- [ ] **PATCH update** — `PATCH /api/employee-master/1001` with one writable field returns `200 { data: {} }`
- [ ] **Unknown field rejected** — `POST /api/employees` with `{ unknownField: "x" }` returns `400 { error: "Unknown field: unknownField" }`
- [ ] **readOnly field rejected** — `POST /api/employees` with `{ employeeId: 1 }` returns `400 { error: "Field 'employeeId' is read-only." }`

---

## Runtime: SYS_REFCURSOR Contract (if published)

- [ ] **GET cursor list** — `GET /api/employees/search` returns `{ data: [...] }` with cursor row mapping applied
- [ ] **Cursor row fields use apiField names** — response fields match `sysRefCursor.fields[].apiField`, not Oracle column names
- [ ] **Boolean transformer applied** — `activeFlag` is `true`/`false`, not `"Y"`/`"N"`

---

## Drift and Retirement

- [ ] **Check drift** — `POST /bridge/contracts/published/:id/check-drift` returns `{ data: { status: "healthy", findings: [] } }` (assuming Oracle hasn't changed)
- [ ] **Drift report persisted** — `GET /bridge/diagnostics/audit?type=contract.drift_checked` (or check `schema_drift_reports` table directly)
- [ ] **Retire contract** — `POST /bridge/contracts/published/:id/retire` with `{ retiredBy: "you" }` returns `200` with `status: "retired"`
- [ ] **Runtime 404 after retire** — `GET /api/employees` (or relevant endpoint) now returns `404` — contract evicted from cache
- [ ] **Double retire is safe** — repeating `POST /bridge/contracts/published/:id/retire` returns `200` without error

---

## Error Handling

- [ ] **Schema mismatch** — if Oracle table is renamed and a request is made, response is `500 { error: "This API contract no longer matches..." }` — no raw ORA message
- [ ] **Missing admin key** — `GET /bridge/connections` without header returns `401`
- [ ] **Invalid UUID** — `GET /bridge/connections/not-a-uuid` returns `400 { error: ... }` — not a 500
