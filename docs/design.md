# Pluggable API Layer on Top of Oracle Legacy Database

## Complete Design Plan with Phase-wise Progress Tracking

---

## 1. Product Goal

Build a **contract-driven pluggable API layer** on top of an existing **Oracle legacy database**.

The system should allow controlled APIs to be created over legacy Oracle tables, views, packages, and stored procedures without directly exposing the database structure to API consumers.

The goal is **not**:

```text
Oracle Table → Auto CRUD API
```

The goal is:

```text
Oracle Schema Metadata
    ↓
Explicit API Contract
    ↓
Resolved Runtime Contract
    ↓
Safe API Execution
```

The original design already established important foundations: schema inspection, admin-defined API contracts, dynamic validations, execution pipeline, and DB error translation. This complete version keeps those ideas and adapts them specifically for Oracle legacy environments. 

---

# 2. Core Principle

## Do not expose Oracle directly

The API layer should never treat visible Oracle tables as automatically safe to expose.

Oracle legacy systems often contain business rules inside:

```text
PL/SQL packages
stored procedures
stored functions
database triggers
views
constraints
sequences
synonyms
legacy application code
```

So the API layer must first determine the correct access path:

```text
1. Direct table read
2. View read
3. Package/procedure read
4. Direct table write
5. Trigger-managed write
6. Package/procedure write
7. Read-only exposure
8. Not safe to expose
```

The safest Oracle modernization rule is:

```text
Read from tables/views where safe.
Write through PL/SQL packages/procedures where business rules exist.
Use direct table DML only when explicitly approved.
```

---

# 3. High-level Architecture

```text
┌──────────────────────────────────────┐
│ Oracle Legacy Database                │
│ - Tables                              │
│ - Views                               │
│ - Sequences                           │
│ - Triggers                            │
│ - Constraints                         │
│ - Packages                            │
│ - Procedures                          │
│ - Functions                           │
│ - Synonyms                            │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Oracle Schema Inspector               │
│ Reads Oracle metadata from ALL_* views │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Draft API Contract                    │
│ Admin/developer-defined mapping       │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Oracle-aware Contract Compiler        │
│ Validates and normalizes config       │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Published Resolved Contract           │
│ Runtime-safe immutable contract       │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Runtime API Layer                     │
│ Auth, validation, execution, mapping  │
└──────────────────────────────────────┘
```

---

# 4. Major System Components

| Component                | Responsibility                                                             |
| ------------------------ | -------------------------------------------------------------------------- |
| Oracle Connector         | Connects to Oracle using service name, SID, TNS, or wallet                 |
| Oracle Schema Inspector  | Reads tables, views, columns, constraints, packages, procedures, sequences |
| Postgres Operational DB  | Stores API-layer contracts, versions, audits, schema snapshots             |
| API Contract Designer    | Defines resources, fields, operations, validations, mappings               |
| Contract Compiler        | Converts draft contracts into validated runtime contracts                  |
| Runtime Contract Cache   | Loads active contracts into memory for fast request resolution             |
| Oracle Query Builder     | Generates safe Oracle SQL with bind variables                              |
| PL/SQL Execution Adapter | Executes Oracle packages/procedures/functions                              |
| Validation Engine        | Runs field, cross-field, business, and Oracle-aware validations            |
| Type Transformer Engine  | Handles Oracle booleans, `CHAR` trimming, date/time mapping                |
| Oracle Error Translator  | Converts `ORA-xxxxx` errors into safe API errors                           |
| Audit & Observability    | Tracks contract changes, runtime calls, errors, drift                      |
| Schema Drift Detector    | Detects mismatch between Oracle metadata and published contracts           |

---

# 5. Operational Metadata Store

## 5.1 Why a Separate Operational DB Is Needed

The API layer needs to store its own data:

```text
Oracle connection metadata
schema snapshots
draft contracts
published contracts
contract versions
compiler diagnostics
publish history
runtime error mappings
audit logs
schema drift status
```

This should **not** be stored inside the legacy Oracle business schema unless absolutely required.

Recommended setup:

```text
Oracle Legacy DB:
- business data
- packages
- procedures
- triggers
- views
- legacy schema

Postgres Operational DB:
- API contracts
- versions
- schema snapshots
- audit logs
- compiler diagnostics
```

## 5.2 Recommended Operational DB

Use **Postgres** for the API-layer operational database.

Use relational columns for common lookup fields and `JSONB` for the full compiled contract.

## 5.3 Core Tables

```text
api_connections
oracle_schema_snapshots
api_contract_drafts
published_contracts
api_contract_versions
contract_publish_history
runtime_error_mappings
api_audit_logs
schema_drift_reports
compiler_diagnostics
```

## 5.4 Published Contracts Table

```sql
CREATE TABLE published_contracts (
    id UUID PRIMARY KEY,
    resource_name VARCHAR(100) NOT NULL,
    version INT NOT NULL,
    endpoint_path VARCHAR(255) NOT NULL,
    contract_data JSONB NOT NULL,
    oracle_owner VARCHAR(100),
    oracle_object_name VARCHAR(100),
    oracle_object_type VARCHAR(50),
    status VARCHAR(30) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    published_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (resource_name, version),
    UNIQUE (endpoint_path, version)
);
```

## 5.5 Suggested Indexes

```sql
CREATE INDEX idx_published_contracts_status
ON published_contracts (status);

CREATE INDEX idx_published_contracts_endpoint
ON published_contracts (endpoint_path);

CREATE INDEX idx_published_contracts_oracle_object
ON published_contracts (oracle_owner, oracle_object_name);

CREATE INDEX idx_published_contracts_contract_data_gin
ON published_contracts
USING GIN (contract_data);
```

## 5.6 Why `JSONB`

`JSONB` is a good fit for compiled contracts because the runtime usually needs to load the complete contract as one object.

Benefits:

```text
fast full-contract loading
simple immutable version storage
reduced relational join complexity
queryable contract internals
good fit for dynamic contract structures
```

Example query:

```sql
SELECT *
FROM published_contracts
WHERE contract_data #>> '{source,name}' = 'EMPLOYEE_MASTER';
```

---

# 6. Runtime Contract Cache

## 6.1 Problem

The runtime should not query Postgres for the contract on every request.

That would create unnecessary latency and make the metadata DB a runtime bottleneck.

## 6.2 Recommended Behavior

```text
On startup:
- load all active published contracts from Postgres
- validate schema version compatibility
- build in-memory endpoint map

On request:
- resolve contract from memory
- execute request using cached resolved contract

On publish/deprecate:
- refresh affected contract
- or reload full contract cache

On metadata DB outage:
- continue using last known good cache
- alert operator
```

## 6.3 Cache Refresh Options

MVP:

```text
manual reload endpoint
reload on runtime restart
```

Better:

```text
Postgres LISTEN/NOTIFY
webhook from publisher to runtime
polling by updated_at
```

Enterprise:

```text
Redis pub/sub
message bus
distributed config cache
```

## 6.4 Acceptance Criteria

```text
[ ] Runtime loads active contracts on startup
[ ] Runtime resolves routes from in-memory cache
[ ] Runtime does not query Postgres per API request
[ ] Published contract changes can refresh runtime cache
[ ] Runtime can continue with last known good contracts if Postgres is temporarily unavailable
```

---

# 7. Oracle Metadata Inspection

## 7.1 Metadata Sources

The Oracle schema inspector should read from:

```text
ALL_TABLES
ALL_TAB_COLUMNS
ALL_CONSTRAINTS
ALL_CONS_COLUMNS
ALL_INDEXES
ALL_IND_COLUMNS
ALL_VIEWS
ALL_SEQUENCES
ALL_OBJECTS
ALL_SYNONYMS
ALL_PROCEDURES
ALL_ARGUMENTS
```

Depending on privileges:

```text
USER_* views — when connected as schema owner
ALL_* views  — recommended default
DBA_* views  — only if DBA-level access is available
```

MVP recommendation:

```text
Use ALL_* views where possible.
Fallback to USER_* views if connected as schema owner.
Do not require DBA_* access for MVP.
```

## 7.2 Inspector Should Read

```text
owners/schemas
tables
views
columns
primary keys
foreign keys
unique constraints
check constraints
not-null constraints
indexes
sequences
synonyms
packages
procedures
functions
procedure arguments
object validity status
```

## 7.3 Normalized Schema Snapshot Example

```json
{
  "database": "legacy_oracle",
  "owner": "HRMS_OWNER",
  "objects": [
    {
      "objectType": "TABLE",
      "objectName": "EMPLOYEE_MASTER",
      "status": "VALID",
      "columns": [
        {
          "name": "EMPLOYEE_ID",
          "dbType": "NUMBER",
          "nullable": false,
          "precision": 10,
          "scale": 0,
          "primaryKey": true
        },
        {
          "name": "EMPLOYEE_NAME",
          "dbType": "VARCHAR2",
          "nullable": false,
          "maxLength": 150
        },
        {
          "name": "ACTIVE_FLAG",
          "dbType": "CHAR",
          "nullable": false,
          "maxLength": 1
        }
      ],
      "constraints": [
        {
          "name": "EMPLOYEE_MASTER_UK1",
          "type": "UNIQUE",
          "columns": ["EMPLOYEE_CODE"]
        }
      ]
    }
  ]
}
```

---

# 8. Oracle-specific Contract Model

## 8.1 Table-backed Resource

```json
{
  "resource": "employees",
  "endpoint": "/api/hr/employees",
  "source": {
    "database": "legacy_oracle",
    "owner": "HRMS_OWNER",
    "type": "table",
    "name": "EMPLOYEE_MASTER"
  },
  "primaryKey": {
    "apiField": "id",
    "dbColumn": "EMPLOYEE_ID",
    "type": "number",
    "generation": {
      "strategy": "sequence",
      "sequenceName": "EMPLOYEE_SEQ"
    }
  }
}
```

## 8.2 View-backed Resource

```json
{
  "resource": "employeeSummaries",
  "endpoint": "/api/hr/employee-summaries",
  "source": {
    "database": "legacy_oracle",
    "owner": "HRMS_OWNER",
    "type": "view",
    "name": "VW_EMPLOYEE_SUMMARY"
  },
  "operations": {
    "read": {
      "enabled": true,
      "permission": "employee.summary.read"
    },
    "create": {
      "enabled": false
    },
    "update": {
      "enabled": false
    },
    "delete": {
      "enabled": false
    }
  }
}
```

## 8.3 Package-backed Resource

```json
{
  "resource": "employees",
  "endpoint": "/api/hr/employees",
  "source": {
    "database": "legacy_oracle",
    "owner": "HRMS_OWNER",
    "type": "package",
    "packageName": "PKG_EMPLOYEE_API"
  },
  "operations": {
    "create": {
      "enabled": true,
      "mode": "package_procedure",
      "procedureName": "CREATE_EMPLOYEE"
    },
    "update": {
      "enabled": true,
      "mode": "package_procedure",
      "procedureName": "UPDATE_EMPLOYEE"
    },
    "read": {
      "enabled": true,
      "mode": "package_procedure",
      "procedureName": "GET_EMPLOYEE"
    }
  }
}
```

---

# 9. Field Mapping

## 9.1 Basic Field Mapping

```json
{
  "apiField": "employeeName",
  "dbColumn": "EMPLOYEE_NAME",
  "oracleType": "VARCHAR2",
  "type": "string",
  "read": true,
  "write": true,
  "required": true,
  "maxLength": 150
}
```

## 9.2 Sensitive Field Mapping

```json
{
  "apiField": "salary",
  "dbColumn": "SALARY_AMOUNT",
  "oracleType": "NUMBER",
  "type": "decimal",
  "read": true,
  "write": false,
  "permission": "employee.salary.read"
}
```

## 9.3 Important Rules

```text
DB column names should not leak into public APIs.
Fields must be explicitly mapped.
Read and write permissions must be separate.
Unmapped Oracle columns are never returned.
System columns should be hidden or read-only.
```

---

# 10. Oracle Type Compatibility

| Oracle Type     | API Type                             | Notes                                |
| --------------- | ------------------------------------ | ------------------------------------ |
| `VARCHAR2`      | string                               | Normal string                        |
| `CHAR`          | string                               | Right-trim by default                |
| `CLOB`          | string                               | Beware large payloads                |
| `NUMBER`        | number / decimal / integer / boolean | Depends on precision/scale           |
| `DATE`          | date-time                            | Oracle `DATE` includes time          |
| `TIMESTAMP`     | date-time                            | Preserve timezone handling carefully |
| `BLOB`          | binary                               | Defer from MVP unless needed         |
| `RAW`           | binary/string                        | Usually base64 or hex encoded        |
| `SYS_REFCURSOR` | array/object stream                  | Used for procedure-backed reads      |

---

# 11. Oracle Type Transformers

## 11.1 Why Transformers Are Needed

Oracle legacy schemas often encode modern API concepts in legacy formats.

Examples:

```text
boolean → CHAR(1) Y/N
boolean → NUMBER(1) 1/0
status → CHAR(10) padded string
date → Oracle DATE with time component
```

The API layer should expose clean API types while mapping correctly to Oracle storage formats.

---

## 11.2 Fake Boolean Mapping

Oracle versions before 23c do not have normal table-level boolean columns. Legacy systems commonly use:

```text
NUMBER(1): 1 / 0
VARCHAR2(1): Y / N
CHAR(1): Y / N
VARCHAR2(1): T / F
```

### Contract Example: `Y` / `N`

```json
{
  "apiField": "isActive",
  "dbColumn": "ACTIVE_FLAG",
  "oracleType": "CHAR",
  "type": "boolean",
  "read": true,
  "write": true,
  "transformer": {
    "kind": "booleanMapping",
    "dbTrueValue": "Y",
    "dbFalseValue": "N",
    "apiTrueValue": true,
    "apiFalseValue": false,
    "trimBeforeMapping": true
  }
}
```

### Contract Example: `1` / `0`

```json
{
  "apiField": "isApproved",
  "dbColumn": "APPROVED_FLAG",
  "oracleType": "NUMBER",
  "type": "boolean",
  "read": true,
  "write": true,
  "transformer": {
    "kind": "booleanMapping",
    "dbTrueValue": 1,
    "dbFalseValue": 0,
    "apiTrueValue": true,
    "apiFalseValue": false
  }
}
```

### Runtime Behavior

Read:

```text
Oracle 'Y' → API true
Oracle 'N' → API false
```

Write:

```text
API true → Oracle 'Y'
API false → Oracle 'N'
```

---

## 11.3 `CHAR` Trimming

Oracle `CHAR` columns are fixed-length and padded with spaces.

Example:

```text
STATUS CHAR(10)
Oracle returns: "ACTIVE    "
API should return: "ACTIVE"
```

### Default Rule

```text
For Oracle CHAR columns:
- trim right-side spaces on read
- validate configured max length on write
```

### Contract Example

```json
{
  "apiField": "status",
  "dbColumn": "STATUS",
  "oracleType": "CHAR",
  "type": "string",
  "read": true,
  "write": true,
  "transformer": {
    "kind": "trimRight",
    "enabled": true
  }
}
```

Trimming should be enabled by default for `CHAR`.

---

## 11.4 Read Mapping Order

The Oracle read mapper should apply transformations in this order:

```text
1. Read raw Oracle value
2. Apply Oracle type normalization
   - CHAR trimRight
   - DATE/TIMESTAMP conversion
   - NUMBER precision/scale handling
3. Apply configured transformer
   - boolean mapping
   - enum mapping
   - custom format mapping
4. Apply field permission hiding/masking
5. Return API field
```

---

# 12. Validation Model

The validation model remains layered.

The uploaded design correctly identified that database constraints alone are not enough for user-friendly API validation, and that dynamic validation should sit above DB execution. 

## 12.1 Validation Layers

```text
1. API Contract Validation
2. Field Validation
3. Cross-field / Business Validation
4. Oracle Type Transformation Validation
5. External / Plugin Validation
6. Database Constraint Validation
```

## 12.2 Field Validation Example

```json
{
  "apiField": "emailAddress",
  "dbColumn": "EMAIL",
  "type": "string",
  "required": true,
  "validations": [
    {
      "type": "regex",
      "value": "^[^@]+@[^@]+\\.[^@]+$",
      "message": "Please enter a valid email address."
    }
  ]
}
```

## 12.3 Cross-field Validation Example

```json
{
  "validations": [
    {
      "type": "fieldComparison",
      "left": "endDate",
      "operator": "greaterThan",
      "right": "startDate",
      "message": "End date must be after start date."
    }
  ]
}
```

## 12.4 Conditional Required Example

```json
{
  "validations": [
    {
      "type": "conditionalRequired",
      "when": {
        "field": "employmentType",
        "operator": "equals",
        "value": "CONTRACT"
      },
      "field": "contractEndDate",
      "message": "Contract end date is required for contract employees."
    }
  ]
}
```

---

# 13. Permissions Model

## 13.1 Endpoint-level Permission

```json
{
  "permission": "employee.read"
}
```

## 13.2 Field-level Permission

```json
{
  "apiField": "salary",
  "dbColumn": "SALARY_AMOUNT",
  "read": true,
  "write": false,
  "permission": "employee.salary.read"
}
```

If the user lacks permission, the field may be:

```text
hidden
masked
returned as null
blocked with error
```

Recommended default:

```text
hidden
```

## 13.3 Row-level / Scope Permission

```json
{
  "scope": {
    "type": "department",
    "dbColumn": "DEPARTMENT_ID",
    "userContextField": "departmentIds"
  }
}
```

Example rules:

```text
HR can see all employees.
Manager can see employees in assigned departments.
Employee can see only their own profile.
Regional admin can see assigned branches.
```

---

# 14. Query and Execution Safety

## 14.1 No Raw SQL from Config

Do not allow this:

```json
{
  "where": "STATUS = 'ACTIVE' AND SALARY_AMOUNT > 10000"
}
```

Use this instead:

```json
{
  "filters": [
    {
      "apiField": "status",
      "dbColumn": "STATUS",
      "operators": ["eq", "in"]
    },
    {
      "apiField": "departmentId",
      "dbColumn": "DEPARTMENT_ID",
      "operators": ["eq", "in"]
    }
  ]
}
```

## 14.2 Bind Variables Only

Every runtime-generated Oracle query must use bind variables.

Example:

```sql
SELECT
  EMPLOYEE_ID,
  EMPLOYEE_NAME
FROM HRMS_OWNER.EMPLOYEE_MASTER
WHERE STATUS = :status
```

## 14.3 Sorting

Only configured fields are sortable.

```json
{
  "sort": {
    "allowedFields": ["employeeCode", "employeeName"],
    "default": [
      {
        "field": "employeeName",
        "direction": "asc"
      }
    ]
  }
}
```

## 14.4 Pagination

All list APIs should enforce pagination.

```json
{
  "pagination": {
    "defaultLimit": 50,
    "maxLimit": 200
  }
}
```

---

# 15. Oracle Pagination Strategy

## 15.1 Version Dependency

Oracle 12c+ supports:

```sql
OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
```

Oracle 11g and older require nested `ROWNUM`.

## 15.2 Phase 0 Requirement

The system must capture:

```text
Oracle version
pagination capability
selected pagination strategy
```

## 15.3 Contract / Connection Metadata

```json
{
  "oracle": {
    "version": "11g",
    "paginationStrategy": "rownum"
  }
}
```

or:

```json
{
  "oracle": {
    "version": "19c",
    "paginationStrategy": "offsetFetch"
  }
}
```

## 15.4 Oracle 12c+ Pagination

```sql
SELECT
  EMPLOYEE_ID,
  EMPLOYEE_NAME
FROM HRMS_OWNER.EMPLOYEE_MASTER
WHERE STATUS = :status
ORDER BY EMPLOYEE_NAME ASC
OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
```

## 15.5 Oracle 11g Pagination

```sql
SELECT *
FROM (
  SELECT a.*, ROWNUM rnum
  FROM (
    SELECT
      EMPLOYEE_ID,
      EMPLOYEE_NAME
    FROM HRMS_OWNER.EMPLOYEE_MASTER
    WHERE STATUS = :status
    ORDER BY EMPLOYEE_NAME ASC
  ) a
  WHERE ROWNUM <= (:offset + :limit)
)
WHERE rnum > :offset
```

---

# 16. Execution Modes

## 16.1 Table-backed Read

Used for simple reads over safe tables.

```json
{
  "source": {
    "type": "table",
    "owner": "HRMS_OWNER",
    "name": "EMPLOYEE_MASTER"
  }
}
```

## 16.2 View-backed Read

Used for summaries, joined read models, and report-friendly APIs.

```json
{
  "source": {
    "type": "view",
    "owner": "HRMS_OWNER",
    "name": "VW_EMPLOYEE_SUMMARY"
  }
}
```

## 16.3 Package/procedure-backed Write

Recommended for Oracle legacy systems where business rules live in PL/SQL.

```json
{
  "operations": {
    "update": {
      "enabled": true,
      "mode": "package_procedure",
      "packageName": "PKG_EMPLOYEE_API",
      "procedureName": "UPDATE_EMPLOYEE"
    }
  }
}
```

## 16.4 Package/procedure-backed Read

Used when reads are exposed through PL/SQL and return `SYS_REFCURSOR`.

```json
{
  "operations": {
    "readList": {
      "enabled": true,
      "mode": "package_procedure",
      "packageName": "PKG_EMPLOYEE_API",
      "procedureName": "GET_EMPLOYEES"
    }
  }
}
```

## 16.5 Optional Direct Table Write

Allowed only for simple master data and only after explicit approval.

```json
{
  "operations": {
    "create": {
      "enabled": true,
      "mode": "direct_table"
    },
    "update": {
      "enabled": true,
      "mode": "direct_table"
    }
  }
}
```

---

# 17. Procedure-backed Reads with `SYS_REFCURSOR`

## 17.1 Problem

Oracle procedures for list/read operations commonly return `SYS_REFCURSOR`.

Example:

```sql
PKG_EMPLOYEE_API.GET_EMPLOYEES(
  P_DEPARTMENT_ID IN NUMBER,
  P_RESULT OUT SYS_REFCURSOR
);
```

The API runtime must convert the cursor result into a JSON response.

## 17.2 Contract Example

```json
{
  "operations": {
    "readList": {
      "enabled": true,
      "mode": "package_procedure",
      "packageName": "PKG_EMPLOYEE_API",
      "procedureName": "GET_EMPLOYEES",
      "params": [
        {
          "apiField": "departmentId",
          "paramName": "P_DEPARTMENT_ID",
          "direction": "IN",
          "type": "NUMBER"
        },
        {
          "apiField": "items",
          "paramName": "P_RESULT",
          "direction": "OUT",
          "type": "SYS_REFCURSOR",
          "resultShape": "array",
          "rowMapping": [
            {
              "apiField": "id",
              "dbColumn": "EMPLOYEE_ID",
              "type": "number"
            },
            {
              "apiField": "employeeName",
              "dbColumn": "EMPLOYEE_NAME",
              "type": "string"
            },
            {
              "apiField": "isActive",
              "dbColumn": "ACTIVE_FLAG",
              "type": "boolean",
              "transformer": {
                "kind": "booleanMapping",
                "dbTrueValue": "Y",
                "dbFalseValue": "N",
                "trimBeforeMapping": true
              }
            }
          ]
        }
      ]
    }
  }
}
```

## 17.3 Runtime Requirements

```text
execute PL/SQL block
bind IN params
bind OUT SYS_REFCURSOR
iterate cursor rows
map cursor columns to API fields
apply Oracle type transformers
apply field permissions
convert result to JSON array
close cursor safely
enforce row limits
```

---

# 18. Procedure-backed Writes

## 18.1 Contract Example

```json
{
  "operations": {
    "create": {
      "enabled": true,
      "mode": "package_procedure",
      "packageName": "PKG_EMPLOYEE_API",
      "procedureName": "CREATE_EMPLOYEE",
      "params": [
        {
          "apiField": "employeeName",
          "paramName": "P_EMPLOYEE_NAME",
          "direction": "IN",
          "type": "VARCHAR2"
        },
        {
          "apiField": "employeeCode",
          "paramName": "P_EMPLOYEE_CODE",
          "direction": "IN",
          "type": "VARCHAR2"
        },
        {
          "apiField": "id",
          "paramName": "P_EMPLOYEE_ID",
          "direction": "OUT",
          "type": "NUMBER"
        }
      ]
    }
  }
}
```

## 18.2 PL/SQL Execution Requirements

```text
support IN parameters
support OUT parameters
support IN OUT parameters if needed
use bind variables
map API fields to params
map OUT params to API response
translate ORA errors
audit procedure name and package name
```

---

# 19. Direct Table Writes

## 19.1 Sequence-generated ID

```json
{
  "primaryKey": {
    "apiField": "id",
    "dbColumn": "EMPLOYEE_ID",
    "type": "number",
    "generation": {
      "strategy": "sequence",
      "sequenceName": "EMPLOYEE_SEQ"
    }
  }
}
```

SQL:

```sql
INSERT INTO HRMS_OWNER.EMPLOYEE_MASTER (
  EMPLOYEE_ID,
  EMPLOYEE_NAME,
  EMPLOYEE_CODE
)
VALUES (
  HRMS_OWNER.EMPLOYEE_SEQ.NEXTVAL,
  :employeeName,
  :employeeCode
)
RETURNING EMPLOYEE_ID INTO :newId
```

## 19.2 Trigger-generated ID

```json
{
  "primaryKey": {
    "apiField": "id",
    "dbColumn": "EMPLOYEE_ID",
    "type": "number",
    "generation": {
      "strategy": "trigger"
    }
  }
}
```

The runtime may need:

```text
RETURNING INTO
or
re-query using unique natural key
```

## 19.3 Direct Update

```sql
UPDATE HRMS_OWNER.EMPLOYEE_MASTER
SET EMPLOYEE_NAME = :employeeName
WHERE EMPLOYEE_ID = :id
```

---

# 20. Optimistic Locking

## 20.1 Problem

Two users can update the same record at nearly the same time, causing lost updates.

## 20.2 Supported Strategies

Recommended:

```text
explicit NUMBER version column
explicit UPDATED_AT timestamp column
```

Avoid for MVP:

```text
ORA_ROWSCN
```

## 20.3 Contract Example

```json
{
  "optimisticLocking": {
    "enabled": true,
    "strategy": "version",
    "apiField": "_version",
    "dbColumn": "VERSION_NO",
    "incrementOnUpdate": true
  }
}
```

## 20.4 SQL Example

```sql
UPDATE HRMS_OWNER.EMPLOYEE_MASTER
SET
  EMPLOYEE_NAME = :employeeName,
  VERSION_NO = VERSION_NO + 1
WHERE
  EMPLOYEE_ID = :id
  AND VERSION_NO = :version
```

If affected rows = `0`, return:

```text
412 Precondition Failed
```

## 20.5 Error Response

```json
{
  "success": false,
  "error": {
    "code": "RECORD_MODIFIED",
    "message": "This record was modified by another user. Please reload and try again.",
    "status": 412
  }
}
```

---

# 21. Oracle Error Translation

## 21.1 Why It Matters

Raw Oracle errors are often cryptic and may leak internal schema details. The design should translate database errors into clean API errors, which was also called out in the original dynamic validation design. 

## 21.2 Common Oracle Error Mapping

| Oracle Error | Meaning                            | API Response               |
| ------------ | ---------------------------------- | -------------------------- |
| `ORA-00001`  | Unique constraint violation        | `409 Conflict`             |
| `ORA-02291`  | Parent key not found               | `400/422 Validation Error` |
| `ORA-02292`  | Child record exists                | `409 Conflict`             |
| `ORA-01400`  | Cannot insert null                 | `400 Bad Request`          |
| `ORA-01438`  | Value larger than column precision | `400 Bad Request`          |
| `ORA-12899`  | Value too large for column         | `400 Bad Request`          |
| `ORA-00942`  | Table/view does not exist          | `CONTRACT_SCHEMA_MISMATCH` |
| `ORA-00904`  | Invalid column                     | `CONTRACT_SCHEMA_MISMATCH` |
| `ORA-01031`  | Insufficient privileges            | DB permission/config error |
| `ORA-06550`  | PL/SQL execution error             | Procedure execution error  |
| `ORA-04063`  | View/package has errors            | Contract/procedure broken  |
| `ORA-01403`  | No data found                      | `404 Not Found`            |

## 21.3 Error Mapping Example

```json
{
  "constraint": "EMPLOYEE_MASTER_UK1",
  "apiField": "employeeCode",
  "errorCode": "EMPLOYEE_CODE_EXISTS",
  "message": "Employee code already exists."
}
```

## 21.4 API Error Example

```json
{
  "success": false,
  "error": {
    "code": "EMPLOYEE_CODE_EXISTS",
    "message": "Employee code already exists.",
    "field": "employeeCode",
    "status": 409
  }
}
```

---

# 22. Runtime Request Lifecycle

## 22.1 Read/List Flow

```text
1. Resolve endpoint from in-memory contract cache
2. Authenticate user
3. Check operation permission
4. Apply row/scope permission
5. Validate filters
6. Validate sorting
7. Apply pagination
8. Generate Oracle SQL or PL/SQL call
9. Execute using bind variables
10. Map Oracle values to API fields
11. Apply type transformers
12. Hide/mask unauthorized fields
13. Return response
14. Write audit log
```

## 22.2 Create/Update Flow

```text
1. Resolve endpoint from in-memory contract cache
2. Authenticate user
3. Check operation permission
4. Reject unknown fields
5. Check field write permissions
6. Run field validations
7. Run cross-field validations
8. Apply type transformers from API → Oracle
9. Apply optimistic locking if enabled
10. Execute package/procedure or direct table SQL
11. Translate Oracle errors
12. Map response back to API shape
13. Write audit log
```

---

# 23. Resolved Contract

## 23.1 Draft vs Resolved

Draft contract:

```text
editable
may be invalid
not used by runtime
```

Resolved contract:

```text
compiled
validated
versioned
published
runtime-safe
immutable
```

## 23.2 Resolved Contract Example

```json
{
  "resource": "employees",
  "version": 3,
  "endpoint": "/api/hr/employees",
  "status": "published",
  "source": {
    "database": "legacy_oracle",
    "owner": "HRMS_OWNER",
    "type": "table",
    "name": "EMPLOYEE_MASTER"
  },
  "runtime": {
    "compilerVersion": "1.0.0",
    "contractSchemaVersion": "1.0.0",
    "publishedAt": "2026-05-06T10:30:00Z",
    "publishedBy": "admin"
  },
  "oracle": {
    "version": "19c",
    "paginationStrategy": "offsetFetch"
  },
  "primaryKey": {
    "apiField": "id",
    "dbColumn": "EMPLOYEE_ID",
    "type": "number"
  },
  "operations": {
    "read": {
      "enabled": true,
      "permission": "employee.read",
      "mode": "direct_table"
    },
    "create": {
      "enabled": true,
      "permission": "employee.create",
      "mode": "package_procedure",
      "packageName": "PKG_EMPLOYEE_API",
      "procedureName": "CREATE_EMPLOYEE"
    }
  },
  "fields": [
    {
      "apiField": "employeeName",
      "dbColumn": "EMPLOYEE_NAME",
      "oracleType": "VARCHAR2",
      "type": "string",
      "read": true,
      "write": true,
      "required": true,
      "maxLength": 150
    },
    {
      "apiField": "isActive",
      "dbColumn": "ACTIVE_FLAG",
      "oracleType": "CHAR",
      "type": "boolean",
      "read": true,
      "write": true,
      "transformer": {
        "kind": "booleanMapping",
        "dbTrueValue": "Y",
        "dbFalseValue": "N",
        "trimBeforeMapping": true
      }
    }
  ]
}
```

---

# 24. Contract Compiler

## 24.1 Responsibilities

```text
validate draft config structure
validate against resolved contract meta-schema
check endpoint uniqueness
verify Oracle connection exists
verify owner/schema exists
verify source object exists
verify object status is VALID
verify mapped columns exist
verify primary key mapping
verify sequence exists if configured
verify package/procedure exists
verify procedure argument mapping
verify SYS_REFCURSOR mapping
verify type compatibility
verify transformer configuration
verify optimistic locking field
verify filters and sorts reference mapped fields
verify permissions are defined
generate resolved runtime contract
```

## 24.2 Oracle-specific Validation

```text
object exists in ALL_OBJECTS
object status is VALID
columns exist in ALL_TAB_COLUMNS
constraints exist in ALL_CONSTRAINTS
sequences exist in ALL_SEQUENCES
procedure arguments exist in ALL_ARGUMENTS
package/procedure is valid
view is valid
synonym resolution, Phase 2
```

## 24.3 Meta-schema Requirement

Before publish, the resolved contract must pass a strict schema validation.

This guarantees the runtime never receives malformed configuration.

---

# 25. Publish Workflow and Versioning

## 25.1 Lifecycle

```text
Draft
  ↓
Validate
  ↓
Compile
  ↓
Publish
  ↓
Active
  ↓
Deprecated
  ↓
Retired
```

## 25.2 Version Data

Track:

```text
resource
version
endpoint
Oracle owner
Oracle object name
Oracle object type
contract schema version
compiler version
published_at
published_by
change_reason
previous_version_id
schema snapshot reference
```

## 25.3 Publishing Rules

```text
Draft contracts are never used at runtime.
Published contracts are immutable.
A new publish creates a new version.
Runtime loads only active published contracts.
```

---

# 26. Schema Drift Handling

## 26.1 Problem

Oracle schema can change outside the API layer.

Examples:

```text
column dropped
column renamed
column type changed
column length reduced
constraint dropped
sequence dropped
view invalidated
package invalidated
procedure signature changed
synonym target changed
privilege revoked
```

## 26.2 MVP Runtime Behavior

If Oracle returns:

```text
ORA-00942
ORA-00904
ORA-04063
ORA-01031
```

Return:

```json
{
  "success": false,
  "error": {
    "code": "CONTRACT_SCHEMA_MISMATCH",
    "message": "This API contract no longer matches the underlying Oracle schema.",
    "status": 500
  }
}
```

## 26.3 Phase 2 Drift Detection

```text
Inspect Oracle metadata
    ↓
Compare against active contracts
    ↓
Mark Healthy / Warning / Drifted / Broken
    ↓
Show in Admin UI
```

## 26.4 Drift Statuses

| Status  | Meaning                          |
| ------- | -------------------------------- |
| Healthy | Contract matches Oracle metadata |
| Warning | Non-critical difference          |
| Drifted | Contract may be affected         |
| Broken  | Contract operation will fail     |

## 26.5 Schema Health Example

```json
{
  "schemaHealth": {
    "status": "broken",
    "lastCheckedAt": "2026-05-06T10:30:00Z",
    "issues": [
      {
        "type": "missing_column",
        "dbColumn": "SALARY_AMOUNT",
        "apiField": "salary",
        "severity": "critical"
      }
    ]
  }
}
```

---

# 27. Safe Includes / Relational Data

## 27.1 Problem

Consumers may ask for:

```http
GET /api/hr/employees?include=department
```

Naive implementation causes N+1 queries.

## 27.2 Design Rule

Includes must be:

```text
explicitly configured
permission-checked
depth-limited
compiled into JOIN plans
not executed as one query per row
```

## 27.3 Include Contract Example

```json
{
  "includes": [
    {
      "name": "department",
      "type": "manyToOne",
      "source": {
        "owner": "HRMS_OWNER",
        "type": "table",
        "name": "DEPARTMENT_MASTER"
      },
      "join": {
        "localColumn": "DEPARTMENT_ID",
        "foreignColumn": "DEPARTMENT_ID"
      },
      "fields": [
        {
          "apiField": "departmentName",
          "dbColumn": "DEPARTMENT_NAME"
        }
      ],
      "permission": "department.read"
    }
  ]
}
```

## 27.4 MVP Recommendation

Do not include relational expansion in MVP unless necessary.

Recommended:

```text
MVP: no includes
Phase 2: depth 1 includes
Later: depth 2 only with strict controls
```

---

# 28. Audit and Observability

## 28.1 Contract Audit Events

```text
contract created
contract updated
contract validated
contract compiled
contract published
contract deprecated
contract retired
schema drift detected
```

## 28.2 Runtime Audit Events

```text
API request received
API request succeeded
API request failed
validation failed
Oracle error occurred
PL/SQL procedure executed
optimistic lock conflict
schema mismatch encountered
```

## 28.3 Runtime Audit Fields

```text
request_id
user_id
resource
endpoint
contract_version
operation
oracle_owner
oracle_object_name
oracle_object_type
oracle_package_name
oracle_procedure_name
oracle_error_code
status
duration_ms
timestamp
```

## 28.4 Logging Rule

Do not log sensitive bind values by default.

---

# 29. Admin UI / Management Console

## 29.1 Recommended UI Sections

```text
Oracle Connections
Schema / Owner Browser
Tables
Views
Sequences
Packages
Procedures
Procedure Arguments
Field Mapper
Type Transformer Mapper
Procedure Parameter Mapper
Operation Policy Editor
Validation Rule Editor
Publish Review
Published Contracts
Contract Version History
Oracle Schema Health
Oracle Error Logs
Audit Logs
```

## 29.2 MVP UI Recommendation

Do not build a full admin UI first.

Start with:

```text
backend APIs
JSON editor
schema browser
publish command
basic diagnostics view
```

Build the polished UI after the runtime model is stable.

---

# 30. Phase-wise Implementation Plan

---

## Phase 0 — Oracle Foundation & Design Lock

### Goal

Lock Oracle-specific assumptions before implementation.

### Scope

```text
[ ] Confirm Oracle version
[ ] Confirm pagination support: OFFSET/FETCH or ROWNUM
[ ] Confirm connection method: service name / SID / TNS / wallet
[ ] Confirm metadata permissions
[ ] Confirm available ALL_* views
[ ] Confirm whether writes must use packages/procedures
[ ] Confirm sequence/trigger ID patterns
[ ] Confirm operational DB choice: Postgres recommended
[ ] Define Oracle contract extensions
[ ] Define Oracle error response format
```

### Acceptance Criteria

```text
[ ] Oracle version is known
[ ] Pagination strategy is selected
[ ] Metadata access is confirmed
[ ] Owner/schema handling is defined
[ ] Write strategy assumptions are documented
[ ] Operational DB strategy is confirmed
```

---

## Phase 1 — Postgres Operational Metadata Store

### Goal

Create internal storage for API-layer metadata.

### Scope

```text
[ ] Create Postgres schema
[ ] Add api_connections table
[ ] Add oracle_schema_snapshots table
[ ] Add api_contract_drafts table
[ ] Add published_contracts table with JSONB
[ ] Add api_contract_versions table
[ ] Add contract_publish_history table
[ ] Add compiler_diagnostics table
[ ] Add api_audit_logs table
[ ] Add schema_drift_reports table
[ ] Add indexes for endpoint, status, Oracle object, JSONB
```

### Acceptance Criteria

```text
[ ] API metadata is stored separately from Oracle business DB
[ ] Published contracts store compiled JSONB
[ ] Draft and published contracts are separated
[ ] Contract versions are traceable
[ ] Audit tables are available
```

---

## Phase 2 — Oracle Connector & Schema Inspector

### Goal

Connect to Oracle and inspect schema metadata.

### Scope

```text
[ ] Build Oracle connection adapter
[ ] Validate Oracle credentials
[ ] Support owner/schema selection
[ ] Inspect tables
[ ] Inspect views
[ ] Inspect columns
[ ] Inspect primary keys
[ ] Inspect foreign keys
[ ] Inspect unique constraints
[ ] Inspect check constraints
[ ] Inspect indexes
[ ] Inspect sequences
[ ] Inspect packages
[ ] Inspect procedures/functions
[ ] Inspect procedure arguments
[ ] Inspect object validity status
[ ] Store schema snapshot
```

### Acceptance Criteria

```text
[ ] System connects to Oracle
[ ] System can inspect selected owner/schema
[ ] Tables, views, sequences, packages, procedures are discovered
[ ] Procedure arguments are available for mapping
[ ] Schema inspection does not publish APIs automatically
```

---

## Phase 3 — Oracle-aware Draft Contract Designer

### Goal

Allow developers/admins to define API contracts over Oracle objects.

### Scope

```text
[ ] Create draft contract APIs
[ ] Select Oracle owner
[ ] Select source type: table/view/package/procedure
[ ] Map Oracle columns to API fields
[ ] Configure operations
[ ] Configure read/write flags
[ ] Configure permissions
[ ] Configure filters
[ ] Configure sorting
[ ] Configure pagination
[ ] Configure sequence/trigger ID strategy
[ ] Configure procedure parameter mapping
[ ] Configure SYS_REFCURSOR result mapping
[ ] Configure boolean transformers
[ ] Configure CHAR trim behavior
[ ] Configure validation rules
```

### Acceptance Criteria

```text
[ ] Draft contract can map Oracle table fields
[ ] Draft contract can map Oracle view fields
[ ] Draft contract can map package/procedure params
[ ] Boolean transformer can be configured
[ ] SYS_REFCURSOR output can be described
[ ] Draft contracts do not affect runtime
```

---

## Phase 4 — Oracle-aware Contract Compiler

### Goal

Validate draft contracts and generate resolved runtime contracts.

### Scope

```text
[ ] Validate draft contract against meta-schema
[ ] Validate Oracle connection
[ ] Validate owner/schema
[ ] Validate source object exists
[ ] Validate object status is VALID
[ ] Validate mapped columns exist
[ ] Validate PK mapping
[ ] Validate sequence exists
[ ] Validate package/procedure exists
[ ] Validate procedure arguments
[ ] Validate SYS_REFCURSOR mapping
[ ] Validate transformer definitions
[ ] Validate filters/sorts
[ ] Validate optimistic locking field
[ ] Validate permissions
[ ] Generate resolved contract
[ ] Store compiler diagnostics
```

### Acceptance Criteria

```text
[ ] Invalid Oracle object blocks publish
[ ] Invalid column blocks publish
[ ] Invalid sequence blocks publish
[ ] Invalid procedure parameter mapping blocks publish
[ ] Invalid transformer blocks publish
[ ] Runtime receives only resolved contracts
```

---

## Phase 5 — Publish Workflow & Versioning

### Goal

Publish immutable resolved contracts.

### Scope

```text
[ ] Add validate action
[ ] Add compile action
[ ] Add publish action
[ ] Assign contract version
[ ] Store resolved contract as JSONB
[ ] Store schema snapshot reference
[ ] Store publish history
[ ] Support active status
[ ] Support deprecated status
[ ] Support retired status
```

### Acceptance Criteria

```text
[ ] Draft config is never used directly by runtime
[ ] Publish creates immutable version
[ ] Active contract is resolvable by endpoint
[ ] Previous versions are traceable
[ ] Publish diagnostics are available
```

---

## Phase 6 — Runtime Contract Cache

### Goal

Load published contracts into memory for fast routing and execution.

### Scope

```text
[ ] Load active contracts on startup
[ ] Build endpoint-to-contract map
[ ] Validate contract schema version at load time
[ ] Add manual cache reload endpoint
[ ] Add cache refresh on publish, if feasible
[ ] Continue using last known good cache if Postgres is unavailable
```

### Acceptance Criteria

```text
[ ] Runtime does not query Postgres per request
[ ] Runtime resolves contracts from memory
[ ] Cache can be refreshed after publish
[ ] Runtime survives temporary metadata DB outage
```

---

## Phase 7 — Runtime Oracle Read/List APIs

### Goal

Serve table/view-backed read APIs.

### Scope

```text
[ ] Implement GET list
[ ] Implement GET by id
[ ] Generate Oracle SELECT
[ ] Use bind variables
[ ] Apply allowed filters
[ ] Apply allowed sorting
[ ] Apply Oracle pagination strategy
[ ] Map Oracle columns to API fields
[ ] Hide unmapped columns
[ ] Apply field permissions
[ ] Apply row/scope permissions, if configured
[ ] Add audit logging
```

### Acceptance Criteria

```text
[ ] Only published contracts are served
[ ] Oracle SQL uses bind variables
[ ] Unmapped columns are never returned
[ ] Pagination works for configured Oracle version
[ ] Filters and sorts are allow-listed
[ ] Unauthorized fields are hidden
```

---

## Phase 8 — Oracle Type Normalization & Transformers

### Goal

Normalize Oracle values into clean API values.

### Scope

```text
[ ] Right-trim CHAR values by default
[ ] Map Y/N to boolean
[ ] Map 1/0 to boolean
[ ] Normalize DATE values
[ ] Normalize TIMESTAMP values
[ ] Enforce NUMBER precision/scale handling
[ ] Apply transformers on read
[ ] Apply transformers on write
[ ] Validate transformer config in compiler
```

### Acceptance Criteria

```text
[ ] CHAR values do not return padded strings
[ ] Fake booleans return true/false
[ ] Boolean writes map back to Oracle values
[ ] Invalid transformer config blocks publish
[ ] DATE/TIMESTAMP output is consistent
```

---

## Phase 9 — Oracle Error Translation

### Goal

Convert Oracle errors into safe API errors.

### Scope

```text
[ ] Parse ORA error codes
[ ] Parse constraint names where available
[ ] Map ORA-00001 to 409
[ ] Map ORA-02291 / ORA-02292
[ ] Map ORA-01400
[ ] Map ORA-01438
[ ] Map ORA-12899
[ ] Map ORA-00942 / ORA-00904
[ ] Map ORA-06550
[ ] Map ORA-04063
[ ] Hide raw Oracle stack traces
[ ] Support configurable error mappings
```

### Acceptance Criteria

```text
[ ] Raw ORA errors are not exposed
[ ] Unique constraint errors return clean 409
[ ] Missing table/column returns CONTRACT_SCHEMA_MISMATCH
[ ] PL/SQL errors are safely translated
[ ] Error response includes stable API code
```

---

## Phase 10 — Procedure/Package-backed Writes

### Goal

Support Oracle package/procedure-backed create and update operations.

### Scope

```text
[ ] Execute package procedure
[ ] Support IN params
[ ] Support OUT params
[ ] Support IN OUT params
[ ] Map API fields to procedure params
[ ] Map OUT params to API response
[ ] Use bind variables
[ ] Translate Oracle/PLSQL errors
[ ] Add procedure execution audit
```

### Acceptance Criteria

```text
[ ] Package-backed create works
[ ] Package-backed update works
[ ] Params are mapped correctly
[ ] OUT values are returned correctly
[ ] PL/SQL errors are safe
```

---

## Phase 11 — `SYS_REFCURSOR` Procedure Reads

### Goal

Support procedure-backed read/list operations that return cursors.

### Scope

```text
[ ] Bind OUT SYS_REFCURSOR
[ ] Iterate cursor rows
[ ] Map cursor columns to API fields
[ ] Apply CHAR trimming
[ ] Apply boolean transformers
[ ] Apply field permissions
[ ] Convert rows to JSON array
[ ] Close cursor safely
[ ] Enforce max row limits
```

### Acceptance Criteria

```text
[ ] Procedure-backed list can return JSON array
[ ] SYS_REFCURSOR rows are mapped correctly
[ ] Cursor resources are closed
[ ] Large result sets are bounded
```

---

## Phase 12 — Optional Direct Table Writes

### Goal

Support direct insert/update only for approved simple data.

### Scope

```text
[ ] Implement direct INSERT
[ ] Implement direct UPDATE
[ ] Support sequence-generated IDs
[ ] Support trigger-generated IDs
[ ] Support RETURNING INTO
[ ] Reject unknown fields
[ ] Reject read-only fields
[ ] Apply validations
[ ] Translate errors
```

### Acceptance Criteria

```text
[ ] Direct writes are disabled by default
[ ] Direct writes only work if explicitly enabled
[ ] Sequence ID generation works
[ ] Trigger ID strategy works where configured
[ ] Read-only fields cannot be written
```

---

## Phase 13 — Optimistic Locking

### Goal

Prevent lost updates.

### Scope

```text
[ ] Add optimistic locking contract block
[ ] Validate version/timestamp column exists
[ ] Require version/timestamp on update
[ ] Add lock condition to UPDATE/procedure if supported
[ ] Increment version if configured
[ ] Detect zero affected rows
[ ] Return 412 Precondition Failed
[ ] Audit conflict
```

### Acceptance Criteria

```text
[ ] Stale update does not overwrite newer data
[ ] Missing version returns validation error
[ ] Version mismatch returns 412
[ ] Successful update increments version when configured
```

---

## Phase 14 — Audit & Observability

### Goal

Trace contract lifecycle and runtime behavior.

### Scope

```text
[ ] Add request ID generation
[ ] Log contract lifecycle events
[ ] Log runtime API calls
[ ] Log validation failures
[ ] Log Oracle errors
[ ] Log procedure execution
[ ] Log optimistic lock conflicts
[ ] Track contract version per request
[ ] Avoid sensitive bind value logging
```

### Acceptance Criteria

```text
[ ] Every request maps to a contract version
[ ] Oracle object/procedure is visible internally
[ ] Errors are searchable by code
[ ] Sensitive values are not logged by default
```

---

## Phase 15 — Oracle Schema Drift Handling

### Goal

Detect mismatch between published contracts and Oracle schema.

### Scope

```text
[ ] Catch runtime schema mismatch errors
[ ] Add on-demand drift check
[ ] Compare active contracts with Oracle metadata
[ ] Check column existence
[ ] Check column type/length changes
[ ] Check sequence existence
[ ] Check object status
[ ] Check package/procedure argument signatures
[ ] Check privilege-related failures
[ ] Mark Healthy / Warning / Drifted / Broken
[ ] Store drift report
```

### Acceptance Criteria

```text
[ ] Missing column is detected
[ ] Invalid package is detected
[ ] Dropped sequence is detected
[ ] Changed procedure signature is detected
[ ] Admin can see drift details
```

---

## Phase 16 — Safe Includes / Relational Data

### Goal

Support configured relational includes without N+1 queries.

### Scope

```text
[ ] Define include contract format
[ ] Validate join columns
[ ] Generate Oracle JOIN SQL
[ ] Prevent per-row lookup queries
[ ] Enforce max include depth
[ ] Map nested response
[ ] Apply include permissions
```

### Acceptance Criteria

```text
[ ] Configured include works through JOIN
[ ] Unknown include is rejected
[ ] Unauthorized include is hidden or rejected
[ ] Query count does not grow per row
```

---

## Phase 17 — Admin UI / Management Console

### Goal

Build UI for managing Oracle-backed API contracts.

### Scope

```text
[ ] Oracle connection screen
[ ] Owner/schema browser
[ ] Table browser
[ ] View browser
[ ] Sequence browser
[ ] Package/procedure browser
[ ] Procedure argument viewer
[ ] Field mapping UI
[ ] Transformer mapping UI
[ ] Procedure param mapping UI
[ ] Publish review screen
[ ] Contract version history
[ ] Schema drift dashboard
[ ] Runtime error dashboard
[ ] Audit log screen
```

### Acceptance Criteria

```text
[ ] Admin can inspect Oracle schema
[ ] Admin can create table/view-backed contract
[ ] Admin can map package/procedure params
[ ] Admin can validate and publish contract
[ ] Admin can see drift and runtime errors
```

---

# 31. Updated MVP Scope

## MVP Must Include

```text
Postgres operational metadata DB
JSONB published contract storage
Oracle connector
Oracle version detection
Oracle owner/schema support
Oracle schema inspector
Tables/views/columns/constraints/sequences metadata
Packages/procedures/arguments metadata
Draft contract storage
Oracle-aware contract compiler
Resolved contract meta-schema validation
Publish workflow
Runtime contract cache
Table/view-backed read/list APIs
Oracle bind-variable query builder
Oracle pagination:
  - OFFSET/FETCH for newer Oracle
  - ROWNUM for Oracle 11g
Oracle error translation
Oracle type normalization:
  - CHAR trimRight
  - fake boolean mapping
  - DATE/TIMESTAMP normalization
Basic validations
Safe filters
Safe sorting
Field mapping
Read/write field control
Basic audit logging
Controlled schema mismatch handling
```

## MVP+ Should Include

```text
Package/procedure-backed writes
SYS_REFCURSOR-backed reads
Procedure OUT param mapping
Trigger-generated ID support
Sequence-generated ID support
Optimistic locking
On-demand schema drift check
```

## Phase 2 Should Include

```text
Scheduled schema drift detection
Synonym-aware object resolution
Procedure signature drift detection
Invalid package/view detection
Safe includes/JOINs
Advanced row-level permissions
Contract rollback
Admin UI polish
```

## Phase 3 Should Include

```text
Multi-schema resources
Cross-schema permission support
Advanced package integration
OpenAPI generation
Consumer SDK generation
Event publishing
GraphQL, if needed
Advanced observability
```

---

# 32. Phase Summary Table

| Phase | Name                                     | Priority | Status      |
| ----- | ---------------------------------------- | -------: | ----------- |
| 0     | Oracle Foundation & Design Lock          |      MVP | Not Started |
| 1     | Postgres Operational Metadata Store      |      MVP | Not Started |
| 2     | Oracle Connector & Schema Inspector      |      MVP | Not Started |
| 3     | Oracle-aware Draft Contract Designer     |      MVP | Not Started |
| 4     | Oracle-aware Contract Compiler           |      MVP | Not Started |
| 5     | Publish Workflow & Versioning            |      MVP | Not Started |
| 6     | Runtime Contract Cache                   |      MVP | Not Started |
| 7     | Runtime Oracle Read/List APIs            |      MVP | Not Started |
| 8     | Oracle Type Normalization & Transformers |      MVP | Not Started |
| 9     | Oracle Error Translation                 |      MVP | Not Started |
| 10    | Procedure/Package-backed Writes          |     MVP+ | Not Started |
| 11    | `SYS_REFCURSOR` Procedure Reads          |     MVP+ | Not Started |
| 12    | Optional Direct Table Writes             |     MVP+ | Not Started |
| 13    | Optimistic Locking                       |     MVP+ | Not Started |
| 14    | Audit & Observability                    |      MVP | Not Started |
| 15    | Oracle Schema Drift Handling             |  Phase 2 | Not Started |
| 16    | Safe Includes / Relational Data          |  Phase 2 | Not Started |
| 17    | Admin UI / Management Console            | Phase 2+ | Not Started |

---

# 33. Recommended Oracle Build Order

```text
1. Postgres operational metadata DB
2. Oracle connection adapter
3. Oracle schema inspector
4. Oracle object snapshot:
   - tables
   - views
   - columns
   - constraints
   - sequences
   - packages
   - procedures
   - procedure arguments
5. Draft contract storage
6. Oracle-aware contract compiler
7. Publish workflow
8. Runtime contract cache
9. Oracle table/view read APIs
10. Oracle error translation
11. Oracle type transformers:
    - CHAR trim
    - fake boolean mapping
    - DATE/TIMESTAMP normalization
12. Procedure/package-backed writes
13. SYS_REFCURSOR-backed procedure reads
14. Optional direct table writes for safe master data
15. Optimistic locking
16. Audit logging
17. Schema drift detection
18. Safe includes/JOINs
19. Admin UI polish
```

Important adjustment for Oracle:

```text
Do not build table CRUD first as the main path.

Build:
- table/view reads
- package/procedure writes

Then add direct table writes only where explicitly approved.
```

---

# 34. Key Risks and Mitigations

| Risk                                    | Why It Matters                   | Mitigation                      |
| --------------------------------------- | -------------------------------- | ------------------------------- |
| Direct table writes bypass PL/SQL logic | Can corrupt legacy workflows     | Prefer package/procedure writes |
| Oracle object owner ambiguity           | Wrong object may be used         | Store owner/schema explicitly   |
| Sequence/trigger ID handling missing    | Inserts may fail or return no ID | Add explicit ID strategy        |
| Raw ORA errors exposed                  | Leaks internal DB details        | Oracle error translator         |
| Invalid package/view                    | Runtime failure                  | Check `ALL_OBJECTS.STATUS`      |
| Procedure signature drift               | API calls break                  | Inspect `ALL_ARGUMENTS`         |
| `SYS_REFCURSOR` unsupported             | Procedure reads fail             | Add cursor mapping              |
| Fake boolean leakage                    | Bad API shape                    | Add boolean transformer         |
| `CHAR` trailing spaces                  | Frontend matching bugs           | Trim `CHAR` values              |
| Oracle 11g pagination unsupported       | List APIs fail                   | Use ROWNUM strategy             |
| Contract DB bottleneck                  | Runtime latency                  | In-memory contract cache        |
| Schema drift                            | Runtime breakage                 | Drift detection                 |
| N+1 includes                            | Performance failure              | Compile JOIN plans              |
| Sensitive field leakage                 | Security issue                   | Field-level permissions         |
| Malformed contracts                     | Runtime instability              | Meta-schema validation          |

---

# 35. Global Acceptance Criteria

The project is successful when:

```text
[ ] Oracle schema can be inspected safely
[ ] Contracts are explicitly defined, not auto-exposed
[ ] Draft contracts are separated from published contracts
[ ] Published contracts are immutable and versioned
[ ] Runtime uses only resolved contracts
[ ] Runtime uses in-memory contract cache
[ ] Oracle reads use bind variables
[ ] Pagination works for configured Oracle version
[ ] CHAR values are trimmed by default
[ ] Fake booleans map to real API booleans
[ ] Oracle errors are safely translated
[ ] Procedure/package writes are supported
[ ] SYS_REFCURSOR reads are supported
[ ] Direct table writes are opt-in only
[ ] Schema drift can be detected
[ ] Audit logs connect every request to contract version
```

---

# 36. Tracking Template

Use this for each phase.

```markdown
## Phase X — Phase Name

### Goal
...

### Scope
- [ ] Item 1
- [ ] Item 2
- [ ] Item 3

### Oracle-specific Scope
- [ ] Owner/schema handling
- [ ] Oracle metadata validation
- [ ] ORA error handling
- [ ] Procedure/package handling, if applicable

### Deliverables
- [ ] Deliverable 1
- [ ] Deliverable 2

### Acceptance Criteria
- [ ] Acceptance 1
- [ ] Acceptance 2

### Risks / Notes
- ...

### Status
Not Started / In Progress / Blocked / Done
```

---

# 37. Final Implementation Rule

For this Oracle legacy API layer, the main rule is:

```text
The compiler is the safety boundary.
The runtime should only execute published, validated, versioned, schema-checked contracts.
```

And the Oracle-specific rule is:

```text
Do not assume table CRUD is safe just because a table is visible.

First determine whether the safe access path is:
- table read
- view read
- package/procedure read
- package/procedure write
- trigger-managed direct write
- direct table write
- or no exposure at all.
```

That distinction is what makes the solution safe for a real Oracle legacy database rather than just a dynamic CRUD generator.
