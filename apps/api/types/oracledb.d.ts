declare module "oracledb" {
  const oracledb: {
    OUT_FORMAT_ARRAY: number;
    OUT_FORMAT_OBJECT: number;
    STRING: number;
    NUMBER: number;
    DATE: number;
    TIMESTAMP: number;
    CURSOR: number;
    BUFFER: number;
    CLOB: number;
    BLOB: number;
    initOracleClient(options?: { libDir?: string }): void;
    getConnection(
      config: import("../src/bridge/connections/oracle-adapter.js").OracleAdapterConnectionConfig
    ): Promise<import("../src/bridge/connections/oracle-adapter.js").OracleDriverConnection>;
  };

  export default oracledb;
}
