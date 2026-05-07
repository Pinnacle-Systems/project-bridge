import { describe, expect, it, vi } from "vitest";

import {
  createOracleConnectorAdapter,
  type BindParameters,
  type DriverExecuteOptions,
  type DriverExecuteResult,
  type OracleAdapterConnectionConfig,
  type OracleDriver,
  type OracleDriverConnection
} from "../index.js";

function createMockDriver() {
  const execute = vi.fn(async (
    sql: string,
    binds: BindParameters,
    _options?: DriverExecuteOptions
  ): Promise<DriverExecuteResult> => ({
      rows: sql.startsWith("SELECT") ? [{ ok: 1 }] : [],
      rowsAffected: sql.startsWith("UPDATE") ? 1 : undefined,
      outBinds: binds
    }));
  const close = vi.fn(async () => undefined);
  const connection = { execute, close } satisfies OracleDriverConnection;
  const getConnection = vi.fn(async (_config: OracleAdapterConnectionConfig) => connection);
  const driver = {
    OUT_FORMAT_ARRAY: 4001,
    OUT_FORMAT_OBJECT: 4002,
    getConnection
  } satisfies OracleDriver;

  return { driver, connection, execute, close, getConnection };
}

describe("Oracle connector adapter", () => {
  it("opens a connection, runs parameterized queries, and closes safely", async () => {
    const { driver, execute, close } = createMockDriver();
    const adapter = createOracleConnectorAdapter(driver);

    await adapter.openConnection({
      user: "erp_api",
      password: "secret",
      connectString: "localhost:1521/ERPDB"
    });
    const result = await adapter.query("SELECT * FROM EMPLOYEE_MASTER WHERE EMPLOYEE_ID = :employeeId", {
      employeeId: 123
    });
    await adapter.close();

    expect(result.rows).toEqual([{ ok: 1 }]);
    expect(execute).toHaveBeenCalledWith(
      "SELECT * FROM EMPLOYEE_MASTER WHERE EMPLOYEE_ID = :employeeId",
      { employeeId: 123 },
      undefined
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("executes PL/SQL procedure calls with named bind variables", async () => {
    const { driver, execute } = createMockDriver();
    const adapter = createOracleConnectorAdapter(driver);

    await adapter.openConnection({ user: "erp_api", connectString: "ERPDB" });
    await adapter.executeProcedure("PKG_EMPLOYEE_API.CREATE_EMPLOYEE", {
      employeeName: "Ada",
      employeeId: { dir: "out", type: "number" }
    });

    expect(execute).toHaveBeenCalledWith(
      "BEGIN PKG_EMPLOYEE_API.CREATE_EMPLOYEE(employeeName => :employeeName, employeeId => :employeeId); END;",
      {
        employeeName: "Ada",
        employeeId: { dir: "out", type: "number" }
      },
      undefined
    );
  });

  it("rejects unsafe SQL usage without bind parameters", async () => {
    const { driver } = createMockDriver();
    const adapter = createOracleConnectorAdapter(driver);

    await adapter.openConnection({ user: "erp_api", connectString: "ERPDB" });

    await expect(
      adapter.query("SELECT * FROM EMPLOYEE_MASTER WHERE EMPLOYEE_NAME = '${name}'", {})
    ).rejects.toThrow("template interpolation");
    await expect(
      adapter.execute("SELECT * FROM EMPLOYEE_MASTER WHERE EMPLOYEE_ID = :employeeId", {
        employeeId: undefined
      } as unknown as BindParameters)
    ).rejects.toThrow("undefined");
  });

  it("tests connectivity and releases the transient connection", async () => {
    const { driver, execute, close } = createMockDriver();
    const adapter = createOracleConnectorAdapter(driver);

    const ok = await adapter.testConnection({
      user: "erp_api",
      password: "secret",
      connectString: "localhost:1521/ERPDB"
    });

    expect(ok).toBe(true);
    expect(execute).toHaveBeenCalledWith("SELECT 1 FROM DUAL", {}, {});
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("maps readable outFormat options to node-oracledb constants", async () => {
    const { driver, execute } = createMockDriver();
    const adapter = createOracleConnectorAdapter(driver);

    await adapter.openConnection({ user: "erp_api", connectString: "ERPDB" });
    await adapter.query("SELECT * FROM EMPLOYEE_MASTER", {}, { outFormat: "object" });

    expect(execute).toHaveBeenCalledWith("SELECT * FROM EMPLOYEE_MASTER", {}, { outFormat: 4002 });
  });

  it("closes an existing connection before opening another one", async () => {
    const { driver, close, getConnection } = createMockDriver();
    const adapter = createOracleConnectorAdapter(driver);

    await adapter.openConnection({ user: "erp_api", connectString: "ERPDB" });
    await adapter.openConnection({ user: "erp_report", connectString: "ERPDB" });

    expect(getConnection).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
