import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env, loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { createOracleConnectorAdapter } from "../src/bridge/connections/oracle-adapter.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const envFiles = [resolve(scriptDir, "../../../.env"), resolve(scriptDir, "../.env")];

for (const envFile of envFiles) {
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }
}

const driverMode = env.ORACLE_DRIVER_MODE ?? env.NODE_ORACLEDB_DRIVER_MODE;
const clientLibDir = env.ORACLE_CLIENT_LIB_DIR;

if (process.platform === "linux" && driverMode === "thick" && clientLibDir) {
  const libraryPaths = (env.LD_LIBRARY_PATH ?? "").split(":").filter(Boolean);
  if (!libraryPaths.includes(clientLibDir) && env.PROJECT_BRIDGE_ORACLE_SMOKE_REEXEC !== "1") {
    const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      env: {
        ...env,
        LD_LIBRARY_PATH: [clientLibDir, ...libraryPaths].join(":"),
        PROJECT_BRIDGE_ORACLE_SMOKE_REEXEC: "1"
      },
      stdio: "inherit"
    });

    process.exit(result.status ?? 1);
  }
}

const { default: oracledb } = await import("oracledb");

if (driverMode === "thick" || clientLibDir) {
  oracledb.initOracleClient(
    clientLibDir
      ? {
          libDir: clientLibDir
        }
      : undefined
  );
}

const adapter = createOracleConnectorAdapter(oracledb);

await adapter.openConnection({
  user: env.ORACLE_USER!,
  password: env.ORACLE_PASSWORD!,
  connectString: env.ORACLE_CONNECT_STRING!,
});

try {
  const version = await adapter.query(
    "SELECT banner FROM v$version WHERE banner LIKE :banner",
    { banner: "Oracle Database%" },
    { maxRows: 5, outFormat: "object" },
  );

  console.log("Oracle version:", version.rows);

  const tables = await adapter.query(
    `
      SELECT owner, object_name, object_type, status
      FROM all_objects
      WHERE owner = :owner
        AND object_type IN ('TABLE', 'VIEW')
        AND ROWNUM <= 10
    `,
    { owner: env.ORACLE_OWNER! },
    { outFormat: "object" },
  );

  console.log("Objects:", tables.rows);
} finally {
  await adapter.close();
}
