import type { OracleScalarType, ResolvedApiContract } from "../contracts/index.js";
import type { BindValue } from "../connections/oracle-adapter.js";

export type OracleBindTypeRegistry = {
  string: string | number;
  number: string | number;
  date: string | number;
  timestamp: string | number;
  cursor: string | number;
  buffer: string | number;
  clob: string | number;
  blob: string | number;
};

export const testOracleBindTypes: OracleBindTypeRegistry = {
  string: "string",
  number: "number",
  date: "date",
  timestamp: "timestamp",
  cursor: "cursor",
  buffer: "buffer",
  clob: "clob",
  blob: "blob"
};

export function resolveOracleBindType(
  oracleType: OracleScalarType,
  bindTypes: OracleBindTypeRegistry
): string | number {
  switch (oracleType) {
    case "number":
    case "boolean":
      return bindTypes.number;
    case "date":
      return bindTypes.date;
    case "timestamp":
      return bindTypes.timestamp;
    case "sys_refcursor":
      return bindTypes.cursor;
    case "blob":
      return bindTypes.blob;
    case "clob":
      return bindTypes.clob;
    case "raw":
      return bindTypes.buffer;
    case "varchar2":
    case "nvarchar2":
    case "char":
    case "nchar":
      return bindTypes.string;
  }
}

export function buildOutBind(
  oracleType: OracleScalarType,
  bindTypes: OracleBindTypeRegistry
): BindValue {
  return { dir: "out", type: resolveOracleBindType(oracleType, bindTypes) };
}

export function buildInOutBind(
  value: BindValue,
  oracleType: OracleScalarType,
  bindTypes: OracleBindTypeRegistry
): BindValue {
  return {
    dir: "inout",
    val: value as any,
    type: resolveOracleBindType(oracleType, bindTypes)
  };
}

export function buildProcedureName(contract: ResolvedApiContract): string {
  const { owner, type, packageName, procedureName, name } = contract.source;
  if (type === "package") {
    return `${owner}.${packageName}.${procedureName}`;
  }
  return `${owner}.${procedureName ?? name}`;
}
