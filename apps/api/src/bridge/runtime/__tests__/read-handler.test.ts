import { describe, expect, it, vi } from "vitest";
import { createReadHandler, type ReadHandlerContext } from "../read-handler.js";
import type { ResolvedApiContract } from "../../contracts/index.js";
import type { OracleConnectorAdapter } from "../../connections/oracle-adapter.js";
import { createPermissiveChecker } from "../permissions.js";

function makeContract(overrides: Partial<ResolvedApiContract> = {}): ResolvedApiContract {
  return {
    id: "c1",
    resource: "employees",
    version: 1,
    endpoint: "/api/hr/employees",
    status: "active",
    publishedAt: new Date(),
    schemaHealth: { status: "healthy" },
    runtime: { cacheKey: "employees_v1", schemaVersion: "1" },
    source: { database: "db1", owner: "HR", type: "table", name: "EMPLOYEES" },
    fields: [
      { apiField: "id",       apiType: "integer", oracleType: "number",   dbColumn: "EMPLOYEE_ID" },
      { apiField: "name",     apiType: "string",  oracleType: "varchar2", dbColumn: "FULL_NAME" },
      { apiField: "password", apiType: "string",  oracleType: "varchar2", dbColumn: "PASSWORD_HASH", writeOnly: true }
    ],
    operations: [
      { operation: "list", enabled: true },
      { operation: "read", enabled: true }
    ],
    ...overrides
  };
}

function makeAdapter(rows: Record<string, unknown>[]): OracleConnectorAdapter {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
    execute: vi.fn(),
    executePlsqlBlock: vi.fn(),
    executeProcedure: vi.fn(),
    openConnection: vi.fn(),
    close: vi.fn(),
    testConnection: vi.fn()
  };
}

function makeCtx(overrides: Partial<ReadHandlerContext> = {}): ReadHandlerContext {
  return {
    adapter: makeAdapter([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }]),
    permissions: createPermissiveChecker(),
    ...overrides
  };
}

describe("ReadHandler", () => {
  it("1. GET list returns mapped fields.", async () => {
    const adapter = makeAdapter([
      { EMPLOYEE_ID: 1, FULL_NAME: "Alice" },
      { EMPLOYEE_ID: 2, FULL_NAME: "Bob" }
    ]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract: makeContract() });

    expect(status).toBe(200);
    expect(body).toEqual({
      data: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" }
      ]
    });
  });

  it("2. GET by id works when the PK API field is id.", async () => {
    const adapter = makeAdapter([{ EMPLOYEE_ID: 42, FULL_NAME: "Carol" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract: makeContract(), idParam: "42" });

    expect(status).toBe(200);
    expect(body).toEqual({ data: { id: 42, name: "Carol" } });
  });

  it("GET by id works when the PK API field is employeeId.", async () => {
    const contract = makeContract({
      fields: [
        { apiField: "employeeId", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID", readOnly: true },
        { apiField: "name", apiType: "string", oracleType: "varchar2", dbColumn: "FULL_NAME" }
      ]
    });
    const adapter = makeAdapter([{ EMPLOYEE_ID: 42, FULL_NAME: "Carol" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract, idParam: "42" });

    expect(status).toBe(200);
    expect(body).toEqual({ data: { employeeId: 42, name: "Carol" } });
    expect(adapter.query).toHaveBeenCalledWith(
      expect.stringContaining('"EMPLOYEE_ID" = :p1'),
      expect.objectContaining({ p1: "42" }),
      expect.objectContaining({ outFormat: "object" })
    );
  });

  it("GET by id falls back to id when no PK metadata is available.", async () => {
    const contract = makeContract({
      fields: [
        { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID" },
        { apiField: "name", apiType: "string", oracleType: "varchar2", dbColumn: "FULL_NAME" }
      ]
    });
    const adapter = makeAdapter([{ EMPLOYEE_ID: 42, FULL_NAME: "Carol" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract, idParam: "42" });

    expect(status).toBe(200);
    expect(body).toEqual({ data: { id: 42, name: "Carol" } });
    expect(adapter.query).toHaveBeenCalledWith(
      expect.stringContaining('"EMPLOYEE_ID" = :p1'),
      expect.objectContaining({ p1: "42" }),
      expect.objectContaining({ outFormat: "object" })
    );
  });

  it("3. Unknown filter returns 400.", async () => {
    const handle = createReadHandler(makeCtx());

    const { status, body } = await handle({
      contract: makeContract(),
      filters: [{ field: "nonexistent", operator: "eq", value: "x" }]
    });

    expect(status).toBe(400);
    expect((body as any).error).toContain("Unknown filter field: nonexistent");
  });

  it("4. Unmapped (writeOnly) DB column is not returned.", async () => {
    // Mock returns the writeOnly column anyway — handler must strip it.
    const adapter = makeAdapter([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice", PASSWORD_HASH: "secret" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract: makeContract() });

    expect(status).toBe(200);
    const row = (body as any).data[0];
    expect(row).not.toHaveProperty("password");
    expect(row).not.toHaveProperty("PASSWORD_HASH");
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("name");
  });

  it("5. Unauthorized field is hidden when allowedFields is set.", async () => {
    const contract = makeContract({
      operations: [
        { operation: "list", enabled: true, allowedFields: ["id"] },
        { operation: "read", enabled: true }
      ]
    });
    const adapter = makeAdapter([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract });

    expect(status).toBe(200);
    const row = (body as any).data[0];
    expect(row).toEqual({ id: 1 });
    expect(row).not.toHaveProperty("name");
  });

  it("6. Oracle adapter receives bind variables.", async () => {
    const adapter = makeAdapter([{ EMPLOYEE_ID: 7, FULL_NAME: "Dave" }]);
    const handle = createReadHandler(makeCtx({ adapter }));

    await handle({ contract: makeContract(), idParam: "7" });

    expect(adapter.query).toHaveBeenCalledWith(
      expect.stringContaining(":p1"),
      expect.objectContaining({ p1: "7" }),
      expect.objectContaining({ outFormat: "object" })
    );
  });
  it("7. ORA-00942 returns 500 with CONTRACT_SCHEMA_MISMATCH code.", async () => {
    const adapter = makeAdapter([]);
    (adapter.query as any).mockRejectedValue(new Error("ORA-00942: table or view does not exist"));
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract: makeContract() });

    expect(status).toBe(500);
    expect((body as any).success).toBe(false);
    expect((body as any).error.code).toBe("CONTRACT_SCHEMA_MISMATCH");
    // Must not leak the raw ORA message
    expect(JSON.stringify(body)).not.toContain("ORA-00942");
  });

  it("8. ORA-01403 returns 404 with NOT_FOUND code.", async () => {
    const adapter = makeAdapter([]);
    (adapter.query as any).mockRejectedValue(new Error("ORA-01403: no data found"));
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract: makeContract() });

    expect(status).toBe(404);
    expect((body as any).code).toBe("NOT_FOUND");
  });

  describe("Boolean filter transformation", () => {
    function makeBooleanContract(): ResolvedApiContract {
      return makeContract({
        fields: [
          { apiField: "id", apiType: "integer", oracleType: "number", dbColumn: "EMPLOYEE_ID" },
          {
            apiField: "isActive",
            apiType: "boolean",
            oracleType: "varchar2",
            dbColumn: "ACTIVE",
            transformers: [{ kind: "booleanMapping", oracleType: "varchar2", trueValue: "Y", falseValue: "N" }]
          }
        ]
      });
    }

    it("booleanMapping filter: boolean true → binds Oracle 'Y'", async () => {
      const contract = makeBooleanContract();
      const adapter = makeAdapter([{ EMPLOYEE_ID: 1, ACTIVE: "Y" }]);
      const handle = createReadHandler(makeCtx({ adapter }));

      await handle({ contract, filters: [{ field: "isActive", operator: "eq", value: true }] });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('"ACTIVE" = :p1'),
        expect.objectContaining({ p1: "Y" }),
        expect.anything()
      );
    });

    it("booleanMapping filter: boolean false → binds Oracle 'N'", async () => {
      const contract = makeBooleanContract();
      const adapter = makeAdapter([]);
      const handle = createReadHandler(makeCtx({ adapter }));

      await handle({ contract, filters: [{ field: "isActive", operator: "eq", value: false }] });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ p1: "N" }),
        expect.anything()
      );
    });

    it("booleanMapping filter: string 'true' from query params → binds Oracle 'Y'", async () => {
      const contract = makeBooleanContract();
      const adapter = makeAdapter([{ EMPLOYEE_ID: 1, ACTIVE: "Y" }]);
      const handle = createReadHandler(makeCtx({ adapter }));

      await handle({ contract, filters: [{ field: "isActive", operator: "eq", value: "true" }] });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ p1: "Y" }),
        expect.anything()
      );
    });

    it("booleanMapping filter: string 'false' from query params → binds Oracle 'N'", async () => {
      const contract = makeBooleanContract();
      const adapter = makeAdapter([]);
      const handle = createReadHandler(makeCtx({ adapter }));

      await handle({ contract, filters: [{ field: "isActive", operator: "eq", value: "false" }] });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ p1: "N" }),
        expect.anything()
      );
    });

    it("booleanMapping filter: 'in' operator transforms each element", async () => {
      const contract = makeBooleanContract();
      const adapter = makeAdapter([{ EMPLOYEE_ID: 1, ACTIVE: "Y" }]);
      const handle = createReadHandler(makeCtx({ adapter }));

      await handle({ contract, filters: [{ field: "isActive", operator: "in", value: [true, false] }] });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.stringContaining('"ACTIVE" IN'),
        expect.objectContaining({ p1_0: "Y", p1_1: "N" }),
        expect.anything()
      );
    });

    it("non-transformer string filter value is passed through unchanged", async () => {
      const adapter = makeAdapter([{ EMPLOYEE_ID: 1, FULL_NAME: "Alice" }]);
      const handle = createReadHandler(makeCtx({ adapter }));

      await handle({ contract: makeContract(), filters: [{ field: "name", operator: "eq", value: "Alice" }] });

      expect(adapter.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ p1: "Alice" }),
        expect.anything()
      );
    });

    it("unknown filter field still returns 400", async () => {
      const contract = makeBooleanContract();
      const handle = createReadHandler(makeCtx());

      const { status, body } = await handle({
        contract,
        filters: [{ field: "nonexistent", operator: "eq", value: "x" }]
      });

      expect(status).toBe(400);
      expect((body as any).error).toContain("Unknown filter field: nonexistent");
    });
  });

  it("9. Contract constraint mapping produces custom error.", async () => {
    const contract = makeContract({
      errorMappings: [
        {
          constraintName: "EMP_EMAIL_UK",
          apiCode: "EMAIL_TAKEN",
          httpStatus: 409,
          message: "Email already in use.",
          apiField: "email"
        }
      ]
    });
    const adapter = makeAdapter([]);
    (adapter.query as any).mockRejectedValue(
      new Error("ORA-00001: unique constraint (HR.EMP_EMAIL_UK) violated")
    );
    const handle = createReadHandler(makeCtx({ adapter }));

    const { status, body } = await handle({ contract });

    expect(status).toBe(409);
    expect((body as any).code).toBe("EMAIL_TAKEN");
    expect((body as any).field).toBe("email");
    expect((body as any).error).toBe("Email already in use.");
  });
});
