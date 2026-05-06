import { describe, expect, it } from "vitest";
import { translateOracleError } from "../translator.js";
import type { ResolvedApiContract } from "../../contracts/index.js";

function makeContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c1",
    resource: "users",
    version: 1,
    endpoint: "/api/users",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "users_v1", schemaVersion: "1" },
    source: { database: "db1", owner: "HR", type: "table", name: "USERS" },
    operations: [],
    fields: [],
    ...overrides
  };
}

describe("Oracle Error Translator", () => {
  it("translates ORA-00001 (unique constraint)", () => {
    const apiError = translateOracleError(new Error("ORA-00001: unique constraint (HR.EMP_EMAIL_UK) violated"));
    expect(apiError.statusCode).toBe(409);
    expect(apiError.code).toBe("UNIQUE_CONSTRAINT");
    expect(apiError.message).toBe("unique constraint");
    expect(apiError.field).toBeUndefined();
  });

  it("translates ORA-02291 (parent key missing)", () => {
    const apiError = translateOracleError(new Error("ORA-02291: integrity constraint (HR.EMP_DEPT_FK) violated - parent key not found"));
    expect(apiError.statusCode).toBe(409);
    expect(apiError.code).toBe("PARENT_KEY_MISSING");
  });

  it("translates ORA-02292 (child record exists)", () => {
    const apiError = translateOracleError(new Error("ORA-02292: integrity constraint (HR.DEPT_EMP_FK) violated - child record found"));
    expect(apiError.statusCode).toBe(409);
    expect(apiError.code).toBe("CHILD_RECORD_EXISTS");
  });

  it("translates ORA-01400 (required field missing)", () => {
    const apiError = translateOracleError(new Error("ORA-01400: cannot insert NULL into (\"HR\".\"EMPLOYEES\".\"LAST_NAME\")"));
    expect(apiError.statusCode).toBe(400);
    expect(apiError.code).toBe("REQUIRED_FIELD_MISSING");
  });

  it("translates ORA-01438 (precision/value too large)", () => {
    const apiError = translateOracleError(new Error("ORA-01438: value larger than specified precision allowed for this column"));
    expect(apiError.statusCode).toBe(400);
    expect(apiError.code).toBe("PRECISION_TOO_LARGE");
  });

  it("translates ORA-12899 (value too large for column)", () => {
    const apiError = translateOracleError(new Error("ORA-12899: value too large for column \"HR\".\"EMPLOYEES\".\"FIRST_NAME\" (actual: 50, maximum: 20)"));
    expect(apiError.statusCode).toBe(400);
    expect(apiError.code).toBe("VALUE_TOO_LARGE");
  });

  it("translates ORA-00942 (CONTRACT_SCHEMA_MISMATCH)", () => {
    const apiError = translateOracleError(new Error("ORA-00942: table or view does not exist"));
    expect(apiError.statusCode).toBe(500);
    expect(apiError.code).toBe("CONTRACT_SCHEMA_MISMATCH");
  });

  it("translates ORA-00904 (CONTRACT_SCHEMA_MISMATCH)", () => {
    const apiError = translateOracleError(new Error("ORA-00904: \"INVALID_COLUMN\": invalid identifier"));
    expect(apiError.statusCode).toBe(500);
    expect(apiError.code).toBe("CONTRACT_SCHEMA_MISMATCH");
  });

  it("translates ORA-01031 (DB privilege/config error)", () => {
    const apiError = translateOracleError(new Error("ORA-01031: insufficient privileges"));
    expect(apiError.statusCode).toBe(500);
    expect(apiError.code).toBe("DB_PRIVILEGE_ERROR");
  });

  it("translates ORA-06550 (PL/SQL execution error)", () => {
    const apiError = translateOracleError(new Error("ORA-06550: line 1, column 7:\nPLS-00201: identifier 'BAD_PROC' must be declared"));
    expect(apiError.statusCode).toBe(500);
    expect(apiError.code).toBe("PLSQL_EXECUTION_ERROR");
  });

  it("translates ORA-04063 (invalid package/view/procedure)", () => {
    const apiError = translateOracleError(new Error("ORA-04063: view \"HR.BAD_VIEW\" has errors"));
    expect(apiError.statusCode).toBe(500);
    expect(apiError.code).toBe("INVALID_ORACLE_OBJECT");
  });

  it("translates ORA-01403 (not found)", () => {
    const apiError = translateOracleError(new Error("ORA-01403: no data found"));
    expect(apiError.statusCode).toBe(404);
    expect(apiError.code).toBe("NOT_FOUND");
  });

  it("supports constraint mapping via exact parsed name (case-insensitive)", () => {
    const contract = makeContract({
      errorMappings: [
        {
          constraintName: "EMP_EMAIL_UK",
          apiCode: "EMAIL_ALREADY_EXISTS",
          httpStatus: 409,
          message: "A user with this email already exists.",
          apiField: "email"
        }
      ]
    });

    const apiError = translateOracleError(
      new Error("ORA-00001: unique constraint (HR.EMP_EMAIL_UK) violated"),
      contract
    );
    expect(apiError.statusCode).toBe(409);
    expect(apiError.code).toBe("EMAIL_ALREADY_EXISTS");
    expect(apiError.message).toBe("A user with this email already exists.");
    expect(apiError.field).toBe("email");
  });

  it("constraint match is case-insensitive and schema-prefix-independent", () => {
    const contract = makeContract({
      errorMappings: [
        {
          constraintName: "emp_email_uk",   // lowercase in config
          apiCode: "EMAIL_ALREADY_EXISTS",
          httpStatus: 409,
          message: "Duplicate email."
        }
      ]
    });

    // Oracle may render with uppercase prefix
    const apiError = translateOracleError(
      new Error("ORA-00001: unique constraint (MYSCHEMA.EMP_EMAIL_UK) violated"),
      contract
    );
    expect(apiError.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it("supports configured ORA-code override from contract", () => {
    const contract = makeContract({
      errorMappings: [
        {
          oracleCode: "ORA-01400",
          apiCode: "MISSING_REQUIRED_INPUT",
          httpStatus: 422,
          message: "You missed a required input."
        }
      ]
    });

    const apiError = translateOracleError(
      new Error("ORA-01400: cannot insert NULL into (\"HR\".\"EMPLOYEES\".\"LAST_NAME\")"),
      contract
    );
    expect(apiError.statusCode).toBe(422);
    expect(apiError.code).toBe("MISSING_REQUIRED_INPUT");
  });

  it("does not expose raw Oracle stack traces for unknown ORA errors", () => {
    const apiError = translateOracleError(new Error("ORA-20000: User-defined exception\n ORA-06512: at \"HR.PROC\", line 10"));
    expect(apiError.statusCode).toBe(500);
    expect(apiError.code).toBe("DATABASE_ERROR");
    expect(apiError.message).toBe("A database error occurred.");
  });

  it("handles non-Error objects safely", () => {
    const apiError = translateOracleError("random string without ORA code");
    expect(apiError.statusCode).toBe(500);
    expect(apiError.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
