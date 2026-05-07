declare module "oracledb" {
  const oracledb: {
    OUT_FORMAT_ARRAY: number;
    OUT_FORMAT_OBJECT: number;
    initOracleClient(options?: { libDir?: string }): void;
    getConnection(
      config: import("../src/bridge/connections/oracle-adapter.js").OracleAdapterConnectionConfig
    ): Promise<import("../src/bridge/connections/oracle-adapter.js").OracleDriverConnection>;
  };

  export default oracledb;
}
