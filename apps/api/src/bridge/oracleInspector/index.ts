import type {
  OracleAdapterConnectionConfig,
  OracleConnectionRecord,
  OracleConnectionRegistryStore,
  OracleConnectorAdapter
} from "../connections/index.js";

export type OracleInspectableObjectType = "TABLE" | "VIEW";

export type OracleObjectStatus = "VALID" | "INVALID" | "UNKNOWN";

export type OracleProgramUnitType = "PACKAGE_PROCEDURE" | "PACKAGE_FUNCTION" | "PROCEDURE" | "FUNCTION";

export type OracleArgumentDirection = "IN" | "OUT" | "IN/OUT";

export type OracleInspectedSequence = {
  owner: string;
  name: string;
};

export type OracleInspectedArgument = {
  name: string | null;
  position: number;
  direction: OracleArgumentDirection;
  oracleType: string;
  isSysRefCursor: boolean;
};

export type OracleInspectedProgramUnit = {
  owner: string;
  packageName: string | null;
  name: string;
  unitType: OracleProgramUnitType;
  objectStatus: OracleObjectStatus;
  arguments: OracleInspectedArgument[];
  returnType: string | null;
};

export type OracleConstraintType = "PRIMARY_KEY" | "FOREIGN_KEY" | "UNIQUE" | "CHECK" | "NOT_NULL";

export type OracleInspectedConstraint = {
  name: string;
  type: OracleConstraintType;
  columns: string[];
  searchCondition: string | null;
  referencedOwner: string | null;
  referencedObjectName: string | null;
  referencedConstraintName: string | null;
};

export type OracleInspectedIndex = {
  name: string;
  unique: boolean;
  columns: string[];
};

export type OracleInspectedColumn = {
  name: string;
  oracleType: string;
  nullable: boolean;
  dataLength: number | null;
  precision: number | null;
  scale: number | null;
  charLength: number | null;
  dataDefault: string | null;
};

export type OracleInspectedObject = {
  owner: string;
  objectName: string;
  objectType: OracleInspectableObjectType;
  objectStatus: OracleObjectStatus;
  columns: OracleInspectedColumn[];
  constraints: OracleInspectedConstraint[];
  indexes: OracleInspectedIndex[];
};

export type OracleSchemaSnapshot = {
  connectionId: string;
  owner: string;
  inspectedAt: string;
  objects: OracleInspectedObject[];
  sequences: OracleInspectedSequence[];
  programUnits: OracleInspectedProgramUnit[];
};

export type StoredOracleSchemaSnapshot = {
  id: string;
  apiConnectionId: string;
  oracleOwner: string;
  snapshotData: OracleSchemaSnapshot;
  capturedAt: Date;
  capturedBy: string | null;
};

export type OracleSchemaInspectorStore = OracleConnectionRegistryStore & {
  oracleSchemaSnapshot: {
    create(args: {
      data: {
        apiConnectionId: string;
        oracleOwner: string;
        snapshotData: OracleSchemaSnapshot;
        capturedBy?: string;
      };
    }): Promise<StoredOracleSchemaSnapshot>;
  };
};

export type OracleSchemaInspectorOptions = {
  store: OracleSchemaInspectorStore;
  adapterFactory: () => OracleConnectorAdapter;
  resolvePassword?: (connection: OracleConnectionRecord) => Promise<string | undefined> | string | undefined;
  capturedBy?: string;
};

export type OracleSchemaInspectionResult = {
  snapshot: OracleSchemaSnapshot;
  storedSnapshot: StoredOracleSchemaSnapshot;
};

export type OracleSchemaInspector = {
  inspectOracleSchema(connectionId: string, owner: string): Promise<OracleSchemaInspectionResult>;
};

export type OracleObjectSummary = {
  owner: string;
  name: string;
  type: OracleInspectableObjectType;
  status?: OracleObjectStatus;
};

type OracleObjectRow = {
  OWNER?: unknown;
  OBJECT_NAME?: unknown;
  OBJECT_TYPE?: unknown;
  STATUS?: unknown;
  owner?: unknown;
  objectName?: unknown;
  objectType?: unknown;
  status?: unknown;
};

type OracleColumnRow = {
  OWNER?: unknown;
  TABLE_NAME?: unknown;
  COLUMN_NAME?: unknown;
  DATA_TYPE?: unknown;
  NULLABLE?: unknown;
  DATA_LENGTH?: unknown;
  DATA_PRECISION?: unknown;
  DATA_SCALE?: unknown;
  CHAR_LENGTH?: unknown;
  DATA_DEFAULT?: unknown;
  owner?: unknown;
  tableName?: unknown;
  columnName?: unknown;
  dataType?: unknown;
  nullable?: unknown;
  dataLength?: unknown;
  dataPrecision?: unknown;
  dataScale?: unknown;
  charLength?: unknown;
  dataDefault?: unknown;
};

type OracleConstraintRow = {
  OWNER?: unknown;
  TABLE_NAME?: unknown;
  CONSTRAINT_NAME?: unknown;
  CONSTRAINT_TYPE?: unknown;
  SEARCH_CONDITION?: unknown;
  R_OWNER?: unknown;
  R_CONSTRAINT_NAME?: unknown;
  REFERENCED_TABLE_NAME?: unknown;
  COLUMN_NAME?: unknown;
  POSITION?: unknown;
  owner?: unknown;
  tableName?: unknown;
  constraintName?: unknown;
  constraintType?: unknown;
  searchCondition?: unknown;
  referencedOwner?: unknown;
  referencedConstraintName?: unknown;
  referencedTableName?: unknown;
  columnName?: unknown;
  position?: unknown;
};

type OracleIndexRow = {
  OWNER?: unknown;
  TABLE_NAME?: unknown;
  INDEX_NAME?: unknown;
  UNIQUENESS?: unknown;
  COLUMN_NAME?: unknown;
  COLUMN_POSITION?: unknown;
  owner?: unknown;
  tableName?: unknown;
  indexName?: unknown;
  uniqueness?: unknown;
  columnName?: unknown;
  columnPosition?: unknown;
};

type OracleSequenceRow = {
  SEQUENCE_OWNER?: unknown;
  SEQUENCE_NAME?: unknown;
  sequenceOwner?: unknown;
  sequenceName?: unknown;
};

type OracleProcedureRow = {
  OWNER?: unknown;
  OBJECT_NAME?: unknown;
  PROCEDURE_NAME?: unknown;
  OBJECT_TYPE?: unknown;
  owner?: unknown;
  objectName?: unknown;
  procedureName?: unknown;
  objectType?: unknown;
};

type OracleArgumentRow = {
  OWNER?: unknown;
  PACKAGE_NAME?: unknown;
  OBJECT_NAME?: unknown;
  ARGUMENT_NAME?: unknown;
  POSITION?: unknown;
  IN_OUT?: unknown;
  DATA_TYPE?: unknown;
  TYPE_NAME?: unknown;
  owner?: unknown;
  packageName?: unknown;
  objectName?: unknown;
  argumentName?: unknown;
  position?: unknown;
  inOut?: unknown;
  dataType?: unknown;
  typeName?: unknown;
};

type OracleProgramStatusRow = {
  OWNER?: unknown;
  OBJECT_NAME?: unknown;
  OBJECT_TYPE?: unknown;
  STATUS?: unknown;
  owner?: unknown;
  objectName?: unknown;
  objectType?: unknown;
  status?: unknown;
};

const OBJECTS_SQL = `
SELECT
  o.owner,
  o.object_name,
  o.object_type,
  o.status
FROM all_objects o
WHERE o.owner = :owner
  AND o.object_type IN ('TABLE', 'VIEW')
  AND (
    EXISTS (
      SELECT 1
      FROM all_tables t
      WHERE t.owner = o.owner
        AND t.table_name = o.object_name
    )
    OR EXISTS (
      SELECT 1
      FROM all_views v
      WHERE v.owner = o.owner
        AND v.view_name = o.object_name
    )
  )
ORDER BY o.object_type, o.object_name
`;

const COLUMNS_SQL = `
SELECT
  c.owner,
  c.table_name,
  c.column_name,
  c.data_type,
  c.nullable,
  c.data_length,
  c.data_precision,
  c.data_scale,
  c.char_length,
  c.data_default
FROM all_tab_columns c
WHERE c.owner = :owner
  AND EXISTS (
    SELECT 1
    FROM all_objects o
    WHERE o.owner = c.owner
      AND o.object_name = c.table_name
      AND o.object_type IN ('TABLE', 'VIEW')
  )
ORDER BY c.table_name, c.column_id
`;

const CONSTRAINTS_SQL = `
SELECT
  c.owner,
  c.table_name,
  c.constraint_name,
  c.constraint_type,
  c.search_condition,
  c.r_owner,
  c.r_constraint_name,
  rc.table_name AS referenced_table_name,
  cc.column_name,
  cc.position
FROM all_constraints c
LEFT JOIN all_cons_columns cc
  ON cc.owner = c.owner
 AND cc.constraint_name = c.constraint_name
 AND cc.table_name = c.table_name
LEFT JOIN all_constraints rc
  ON rc.owner = c.r_owner
 AND rc.constraint_name = c.r_constraint_name
WHERE c.owner = :owner
  AND c.constraint_type IN ('P', 'R', 'U', 'C')
ORDER BY c.table_name, c.constraint_name, cc.position
`;

const INDEXES_SQL = `
SELECT
  i.owner,
  i.table_name,
  i.index_name,
  i.uniqueness,
  ic.column_name,
  ic.column_position
FROM all_indexes i
LEFT JOIN all_ind_columns ic
  ON ic.index_owner = i.owner
 AND ic.index_name = i.index_name
 AND ic.table_owner = i.owner
 AND ic.table_name = i.table_name
WHERE i.owner = :owner
ORDER BY i.table_name, i.index_name, ic.column_position
`;

const SEQUENCES_SQL = `
SELECT
  s.sequence_owner,
  s.sequence_name
FROM all_sequences s
WHERE s.sequence_owner = :owner
ORDER BY s.sequence_name
`;

const PROCEDURES_SQL = `
SELECT
  p.owner,
  p.object_name,
  p.procedure_name,
  p.object_type
FROM all_procedures p
WHERE p.owner = :owner
  AND p.object_type IN ('PACKAGE', 'PROCEDURE', 'FUNCTION')
ORDER BY p.object_name, p.procedure_name
`;

const ARGUMENTS_SQL = `
SELECT
  a.owner,
  a.package_name,
  a.object_name,
  a.argument_name,
  a.position,
  a.in_out,
  a.data_type,
  a.type_name
FROM all_arguments a
WHERE a.owner = :owner
ORDER BY a.package_name, a.object_name, a.position, a.sequence
`;

const PROGRAM_STATUS_SQL = `
SELECT
  o.owner,
  o.object_name,
  o.object_type,
  o.status
FROM all_objects o
WHERE o.owner = :owner
  AND o.object_type IN ('PACKAGE', 'PROCEDURE', 'FUNCTION')
ORDER BY o.object_type, o.object_name
`;

export function createOracleSchemaInspector(options: OracleSchemaInspectorOptions): OracleSchemaInspector {
  return {
    async inspectOracleSchema(connectionId, owner) {
      const normalizedOwner = normalizeOwner(owner);
      const connection = await options.store.apiConnection.findUnique({ where: { id: connectionId } });
      if (!connection) {
        throw new Error(`Oracle connection not found: ${connectionId}`);
      }

      const adapter = options.adapterFactory();
      await adapter.openConnection(await toAdapterConfig(connection, options.resolvePassword));

      try {
        const objectResult = await adapter.query<OracleObjectRow>(
          OBJECTS_SQL,
          { owner: normalizedOwner },
          { outFormat: "object" }
        );
        const columnResult = await adapter.query<OracleColumnRow>(
          COLUMNS_SQL,
          { owner: normalizedOwner },
          { outFormat: "object" }
        );
        const constraintResult = await adapter.query<OracleConstraintRow>(
          CONSTRAINTS_SQL,
          { owner: normalizedOwner },
          { outFormat: "object" }
        );
        const indexResult = await adapter.query<OracleIndexRow>(
          INDEXES_SQL,
          { owner: normalizedOwner },
          { outFormat: "object" }
        );
        const sequenceResult = await adapter.query<OracleSequenceRow>(
          SEQUENCES_SQL,
          { owner: normalizedOwner },
          { outFormat: "object" }
        );
        const procedureResult = await adapter.query<OracleProcedureRow>(
          PROCEDURES_SQL,
          { owner: normalizedOwner },
          { outFormat: "object" }
        );
        const argumentResult = await adapter.query<OracleArgumentRow>(
          ARGUMENTS_SQL,
          { owner: normalizedOwner },
          { outFormat: "object" }
        );
        const programStatusResult = await adapter.query<OracleProgramStatusRow>(
          PROGRAM_STATUS_SQL,
          { owner: normalizedOwner },
          { outFormat: "object" }
        );

        const snapshot: OracleSchemaSnapshot = {
          connectionId,
          owner: normalizedOwner,
          inspectedAt: new Date().toISOString(),
          objects: mapObjects(objectResult.rows, columnResult.rows, constraintResult.rows, indexResult.rows),
          sequences: mapSequences(sequenceResult.rows),
          programUnits: mapProgramUnits(procedureResult.rows, argumentResult.rows, programStatusResult.rows)
        };

        const storedSnapshot = await options.store.oracleSchemaSnapshot.create({
          data: {
            apiConnectionId: connectionId,
            oracleOwner: normalizedOwner,
            snapshotData: snapshot,
            capturedBy: options.capturedBy
          }
        });

        return { snapshot, storedSnapshot };
      } finally {
        await adapter.close();
      }
    }
  };
}

function mapObjects(
  objectRows: OracleObjectRow[],
  columnRows: OracleColumnRow[],
  constraintRows: OracleConstraintRow[],
  indexRows: OracleIndexRow[]
): OracleInspectedObject[] {
  const columnsByObject = new Map<string, OracleInspectedColumn[]>();
  const constraintsByObject = mapConstraintsByObject(constraintRows);
  const indexesByObject = mapIndexesByObject(indexRows);

  for (const row of columnRows) {
    const owner = stringValue(row.OWNER ?? row.owner);
    const objectName = stringValue(row.TABLE_NAME ?? row.tableName);
    if (!owner || !objectName) {
      continue;
    }
    const key = objectKey(owner, objectName);
    const columns = columnsByObject.get(key) ?? [];
    columns.push(mapColumn(row));
    columnsByObject.set(key, columns);
  }

  return objectRows.map((row) => {
    const owner = stringValue(row.OWNER ?? row.owner) ?? "";
    const objectName = stringValue(row.OBJECT_NAME ?? row.objectName) ?? "";
    const objectType = normalizeObjectType(row.OBJECT_TYPE ?? row.objectType);

    return {
      owner,
      objectName,
      objectType,
      objectStatus: normalizeObjectStatus(row.STATUS ?? row.status),
      columns: columnsByObject.get(objectKey(owner, objectName)) ?? [],
      constraints: constraintsByObject.get(objectKey(owner, objectName)) ?? [],
      indexes: indexesByObject.get(objectKey(owner, objectName)) ?? []
    };
  });
}

function mapConstraintsByObject(rows: OracleConstraintRow[]): Map<string, OracleInspectedConstraint[]> {
  const constraintsByName = new Map<string, OracleInspectedConstraint & { owner: string; objectName: string }>();

  for (const row of rows) {
    const owner = stringValue(row.OWNER ?? row.owner);
    const objectName = stringValue(row.TABLE_NAME ?? row.tableName);
    const constraintName = stringValue(row.CONSTRAINT_NAME ?? row.constraintName);
    if (!owner || !objectName || !constraintName) {
      continue;
    }

    const rawType = stringValue(row.CONSTRAINT_TYPE ?? row.constraintType);
    const searchCondition = stringValue(row.SEARCH_CONDITION ?? row.searchCondition);
    const type = normalizeConstraintType(rawType, searchCondition);
    const key = `${objectKey(owner, objectName)}.${constraintName}`;
    const existing = constraintsByName.get(key) ?? {
      owner,
      objectName,
      name: constraintName,
      type,
      columns: [],
      searchCondition,
      referencedOwner: stringValue(row.R_OWNER ?? row.referencedOwner),
      referencedObjectName: stringValue(row.REFERENCED_TABLE_NAME ?? row.referencedTableName),
      referencedConstraintName: stringValue(row.R_CONSTRAINT_NAME ?? row.referencedConstraintName)
    };

    const columnName = stringValue(row.COLUMN_NAME ?? row.columnName);
    if (columnName && !existing.columns.includes(columnName)) {
      existing.columns.push(columnName);
    }
    constraintsByName.set(key, existing);
  }

  const grouped = new Map<string, OracleInspectedConstraint[]>();
  for (const constraint of constraintsByName.values()) {
    const key = objectKey(constraint.owner, constraint.objectName);
    const constraints = grouped.get(key) ?? [];
    const { owner: _owner, objectName: _objectName, ...normalizedConstraint } = constraint;
    constraints.push(normalizedConstraint);
    grouped.set(key, constraints);
  }

  return grouped;
}

function mapIndexesByObject(rows: OracleIndexRow[]): Map<string, OracleInspectedIndex[]> {
  const indexesByName = new Map<string, OracleInspectedIndex & { owner: string; objectName: string }>();

  for (const row of rows) {
    const owner = stringValue(row.OWNER ?? row.owner);
    const objectName = stringValue(row.TABLE_NAME ?? row.tableName);
    const indexName = stringValue(row.INDEX_NAME ?? row.indexName);
    if (!owner || !objectName || !indexName) {
      continue;
    }

    const key = `${objectKey(owner, objectName)}.${indexName}`;
    const existing = indexesByName.get(key) ?? {
      owner,
      objectName,
      name: indexName,
      unique: (stringValue(row.UNIQUENESS ?? row.uniqueness) ?? "").toUpperCase() === "UNIQUE",
      columns: []
    };

    const columnName = stringValue(row.COLUMN_NAME ?? row.columnName);
    if (columnName && !existing.columns.includes(columnName)) {
      existing.columns.push(columnName);
    }
    indexesByName.set(key, existing);
  }

  const grouped = new Map<string, OracleInspectedIndex[]>();
  for (const index of indexesByName.values()) {
    const key = objectKey(index.owner, index.objectName);
    const indexes = grouped.get(key) ?? [];
    const { owner: _owner, objectName: _objectName, ...normalizedIndex } = index;
    indexes.push(normalizedIndex);
    grouped.set(key, indexes);
  }

  return grouped;
}

function mapSequences(rows: OracleSequenceRow[]): OracleInspectedSequence[] {
  return rows.flatMap((row) => {
    const owner = stringValue(row.SEQUENCE_OWNER ?? row.sequenceOwner);
    const name = stringValue(row.SEQUENCE_NAME ?? row.sequenceName);
    return owner && name ? [{ owner, name }] : [];
  });
}

function mapProgramUnits(
  procedureRows: OracleProcedureRow[],
  argumentRows: OracleArgumentRow[],
  statusRows: OracleProgramStatusRow[]
): OracleInspectedProgramUnit[] {
  const statusByObject = new Map<string, OracleObjectStatus>();
  for (const row of statusRows) {
    const owner = stringValue(row.OWNER ?? row.owner);
    const objectName = stringValue(row.OBJECT_NAME ?? row.objectName);
    if (owner && objectName) {
      statusByObject.set(objectKey(owner, objectName), normalizeObjectStatus(row.STATUS ?? row.status));
    }
  }

  const argumentsByUnit = mapArgumentsByUnit(argumentRows);

  return procedureRows.flatMap((row) => {
    const owner = stringValue(row.OWNER ?? row.owner);
    const objectName = stringValue(row.OBJECT_NAME ?? row.objectName);
    const procedureName = stringValue(row.PROCEDURE_NAME ?? row.procedureName);
    const objectType = stringValue(row.OBJECT_TYPE ?? row.objectType)?.toUpperCase();
    if (!owner || !objectName) {
      return [];
    }

    const packageName = objectType === "PACKAGE" ? objectName : null;
    const name = procedureName ?? objectName;
    const unitArguments = argumentsByUnit.get(programUnitKey(owner, packageName, name)) ?? [];
    const returnArgument = unitArguments.find((argument) => argument.position === 0);

    return [
      {
        owner,
        packageName,
        name,
        unitType: normalizeProgramUnitType(objectType, packageName, returnArgument),
        objectStatus: statusByObject.get(objectKey(owner, packageName ?? objectName)) ?? "UNKNOWN",
        arguments: unitArguments.filter((argument) => argument.position !== 0),
        returnType: returnArgument?.oracleType ?? null
      }
    ];
  });
}

function mapArgumentsByUnit(rows: OracleArgumentRow[]): Map<string, OracleInspectedArgument[]> {
  const grouped = new Map<string, OracleInspectedArgument[]>();

  for (const row of rows) {
    const owner = stringValue(row.OWNER ?? row.owner);
    const packageName = stringValue(row.PACKAGE_NAME ?? row.packageName);
    const objectName = stringValue(row.OBJECT_NAME ?? row.objectName);
    if (!owner || !objectName) {
      continue;
    }

    const key = programUnitKey(owner, packageName, objectName);
    const args = grouped.get(key) ?? [];
    args.push(mapArgument(row));
    grouped.set(key, args);
  }

  return grouped;
}

function mapArgument(row: OracleArgumentRow): OracleInspectedArgument {
  const oracleType = stringValue(row.DATA_TYPE ?? row.dataType ?? row.TYPE_NAME ?? row.typeName) ?? "UNKNOWN";

  return {
    name: stringValue(row.ARGUMENT_NAME ?? row.argumentName),
    position: numberValue(row.POSITION ?? row.position) ?? 0,
    direction: normalizeArgumentDirection(row.IN_OUT ?? row.inOut),
    oracleType,
    isSysRefCursor: oracleType.toUpperCase() === "REF CURSOR" || oracleType.toUpperCase() === "SYS_REFCURSOR"
  };
}

function mapColumn(row: OracleColumnRow): OracleInspectedColumn {
  return {
    name: stringValue(row.COLUMN_NAME ?? row.columnName) ?? "",
    oracleType: stringValue(row.DATA_TYPE ?? row.dataType) ?? "UNKNOWN",
    nullable: (stringValue(row.NULLABLE ?? row.nullable) ?? "Y").toUpperCase() === "Y",
    dataLength: numberValue(row.DATA_LENGTH ?? row.dataLength),
    precision: numberValue(row.DATA_PRECISION ?? row.dataPrecision),
    scale: numberValue(row.DATA_SCALE ?? row.dataScale),
    charLength: numberValue(row.CHAR_LENGTH ?? row.charLength),
    dataDefault: stringValue(row.DATA_DEFAULT ?? row.dataDefault)
  };
}

function normalizeOwner(owner: string): string {
  const normalizedOwner = owner.trim().toUpperCase();
  if (!normalizedOwner) {
    throw new Error("Oracle owner/schema is required for schema inspection.");
  }
  return normalizedOwner;
}

function normalizeObjectType(value: unknown): OracleInspectableObjectType {
  return stringValue(value)?.toUpperCase() === "VIEW" ? "VIEW" : "TABLE";
}

function normalizeObjectStatus(value: unknown): OracleObjectStatus {
  const status = stringValue(value)?.toUpperCase();
  if (status === "VALID" || status === "INVALID") {
    return status;
  }
  return "UNKNOWN";
}

function normalizeConstraintType(rawType: string | null, searchCondition: string | null): OracleConstraintType {
  if (rawType === "P") {
    return "PRIMARY_KEY";
  }
  if (rawType === "R") {
    return "FOREIGN_KEY";
  }
  if (rawType === "U") {
    return "UNIQUE";
  }
  if (rawType === "C" && searchCondition && /\bIS\s+NOT\s+NULL\b/i.test(searchCondition)) {
    return "NOT_NULL";
  }
  return "CHECK";
}

function normalizeArgumentDirection(value: unknown): OracleArgumentDirection {
  const direction = stringValue(value)?.toUpperCase();
  if (direction === "OUT") {
    return "OUT";
  }
  if (direction === "IN/OUT" || direction === "IN OUT") {
    return "IN/OUT";
  }
  return "IN";
}

function normalizeProgramUnitType(
  objectType: string | undefined,
  packageName: string | null,
  returnArgument: OracleInspectedArgument | undefined
): OracleProgramUnitType {
  if (packageName) {
    return returnArgument ? "PACKAGE_FUNCTION" : "PACKAGE_PROCEDURE";
  }
  if (objectType === "FUNCTION" || returnArgument) {
    return "FUNCTION";
  }
  return "PROCEDURE";
}

async function toAdapterConfig(
  connection: OracleConnectionRecord,
  resolvePassword: OracleSchemaInspectorOptions["resolvePassword"]
): Promise<OracleAdapterConnectionConfig> {
  return {
    user: connection.username,
    password: await resolvePassword?.(connection) ?? connection.encryptedPassword ?? undefined,
    connectString: buildConnectString(connection),
    host: connection.host ?? undefined,
    port: connection.port ?? undefined,
    serviceName: connection.serviceName ?? undefined,
    sid: connection.sid ?? undefined,
    walletLocation: connection.walletPath ?? undefined
  };
}

function buildConnectString(connection: OracleConnectionRecord): string | undefined {
  if (connection.connectionType === "tnsAlias" || connection.connectionType === "wallet") {
    return connection.tnsAlias ?? connection.serviceName ?? undefined;
  }
  if (connection.host && connection.port && connection.serviceName) {
    return `${connection.host}:${connection.port}/${connection.serviceName}`;
  }
  if (connection.host && connection.port && connection.sid) {
    return `${connection.host}:${connection.port}:${connection.sid}`;
  }
  return connection.serviceName ?? connection.sid ?? undefined;
}

function objectKey(owner: string, objectName: string): string {
  return `${owner.toUpperCase()}.${objectName.toUpperCase()}`;
}

function programUnitKey(owner: string, packageName: string | null, objectName: string): string {
  return `${owner.toUpperCase()}.${packageName?.toUpperCase() ?? ""}.${objectName.toUpperCase()}`;
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
