export type BindPrimitive = string | number | boolean | Date | Buffer | null;

export type BindValue =
  | BindPrimitive
  | {
      dir?: "in" | "out" | "inout";
      type?: string | number;
      val?: BindPrimitive;
      maxSize?: number;
    };

export type BindParameters = Record<string, BindValue> | BindValue[];

export type OracleAdapterConnectionConfig = {
  user: string;
  password?: string;
  connectString?: string;
  host?: string;
  port?: number;
  serviceName?: string;
  sid?: string;
  walletLocation?: string;
};

export type QueryOptions = {
  maxRows?: number;
  fetchArraySize?: number;
  outFormat?: "object" | "array";
};

export type ExecuteOptions = QueryOptions & {
  autoCommit?: boolean;
};

export type QueryResult<Row = unknown> = {
  rows: Row[];
  metaData?: unknown[];
};

export type ExecuteResult<Row = unknown> = QueryResult<Row> & {
  rowsAffected?: number;
  outBinds?: unknown;
};

export type DriverExecuteResult<Row = unknown> = {
  rows?: Row[];
  metaData?: unknown[];
  rowsAffected?: number;
  outBinds?: unknown;
};

export type OracleDriverConnection = {
  execute(
    sql: string,
    binds: BindParameters,
    options?: ExecuteOptions
  ): Promise<DriverExecuteResult>;
  close(): Promise<void>;
};

export type OracleDriver = {
  getConnection(config: OracleAdapterConnectionConfig): Promise<OracleDriverConnection>;
};

export type DatabaseAdapter<ConnectionConfig> = {
  openConnection(config: ConnectionConfig): Promise<void>;
  close(): Promise<void>;
  testConnection(config: ConnectionConfig): Promise<boolean>;
  query<Row = unknown>(sql: string, binds: BindParameters, options?: QueryOptions): Promise<QueryResult<Row>>;
  execute<Row = unknown>(
    sqlOrPlsql: string,
    binds: BindParameters,
    options?: ExecuteOptions
  ): Promise<ExecuteResult<Row>>;
};

export type OracleConnectorAdapter = DatabaseAdapter<OracleAdapterConnectionConfig> & {
  executePlsqlBlock<Row = unknown>(
    plsqlBlock: string,
    binds: BindParameters,
    options?: ExecuteOptions
  ): Promise<ExecuteResult<Row>>;
  executeProcedure<Row = unknown>(
    procedureName: string,
    binds: Record<string, BindValue>,
    options?: ExecuteOptions
  ): Promise<ExecuteResult<Row>>;
};

export function createOracleConnectorAdapter(driver: OracleDriver): OracleConnectorAdapter {
  let activeConnection: OracleDriverConnection | undefined;

  async function getActiveConnection(): Promise<OracleDriverConnection> {
    if (!activeConnection) {
      throw new Error("Oracle connection is not open.");
    }
    return activeConnection;
  }

  return {
    async openConnection(config) {
      if (activeConnection) {
        await activeConnection.close();
      }
      activeConnection = await driver.getConnection(config);
    },

    async close() {
      if (!activeConnection) {
        return;
      }
      const connection = activeConnection;
      activeConnection = undefined;
      await connection.close();
    },

    async testConnection(config) {
      const connection = await driver.getConnection(config);
      try {
        await connection.execute("SELECT 1 FROM DUAL", {}, {});
        return true;
      } finally {
        await connection.close();
      }
    },

    async query<Row = unknown>(sql: string, binds: BindParameters, options?: QueryOptions) {
      assertSqlText(sql, "query");
      assertBindParameters(binds);
      const connection = await getActiveConnection();
      const result = await connection.execute(sql, binds, options);
      return {
        rows: (result.rows ?? []) as Row[],
        metaData: result.metaData
      };
    },

    async execute<Row = unknown>(sqlOrPlsql: string, binds: BindParameters, options?: ExecuteOptions) {
      assertSqlText(sqlOrPlsql, "execute");
      assertBindParameters(binds);
      const connection = await getActiveConnection();
      const result = await connection.execute(sqlOrPlsql, binds, options);
      return {
        rows: (result.rows ?? []) as Row[],
        metaData: result.metaData,
        rowsAffected: result.rowsAffected,
        outBinds: result.outBinds
      };
    },

    async executePlsqlBlock<Row = unknown>(plsqlBlock: string, binds: BindParameters, options?: ExecuteOptions) {
      assertSqlText(plsqlBlock, "executePlsqlBlock");
      assertBindParameters(binds);
      if (!/^\s*(BEGIN|DECLARE)\b/i.test(plsqlBlock)) {
        throw new Error("PL/SQL blocks must start with BEGIN or DECLARE.");
      }
      return this.execute<Row>(plsqlBlock, binds, options);
    },

    async executeProcedure<Row = unknown>(
      procedureName: string,
      binds: Record<string, BindValue>,
      options?: ExecuteOptions
    ) {
      assertProcedureName(procedureName);
      assertBindRecord(binds);
      const placeholders = Object.keys(binds).map((name) => `${name} => :${name}`).join(", ");
      return this.executePlsqlBlock<Row>(`BEGIN ${procedureName}(${placeholders}); END;`, binds, options);
    }
  };
}

function assertSqlText(sql: string, operation: string): void {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new Error(`${operation} requires SQL text.`);
  }
  if (sql.includes("${")) {
    throw new Error(`${operation} SQL must not contain template interpolation markers.`);
  }
}

function assertBindParameters(binds: BindParameters): void {
  if (!isBindRecord(binds) && !Array.isArray(binds)) {
    throw new Error("Bind parameters are required and must be an object or array.");
  }

  const values = Array.isArray(binds) ? binds : Object.values(binds);
  for (const value of values) {
    if (value === undefined) {
      throw new Error("Bind parameters must not contain undefined values.");
    }
  }
}

function assertBindRecord(binds: Record<string, BindValue>): void {
  assertBindParameters(binds);
  for (const key of Object.keys(binds)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid bind parameter name: ${key}.`);
    }
  }
}

function assertProcedureName(procedureName: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_$#]*(\.[A-Za-z][A-Za-z0-9_$#]*)?$/.test(procedureName)) {
    throw new Error("Procedure name must be a simple Oracle identifier or package.procedure identifier.");
  }
}

function isBindRecord(value: unknown): value is Record<string, BindValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
