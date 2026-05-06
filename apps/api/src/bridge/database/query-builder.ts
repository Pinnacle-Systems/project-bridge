import type { ResolvedApiContract } from "../contracts/index.js";

export type QueryRequestFilter = {
  field: string;
  operator: string;
  value: any;
};

export type QueryRequestSort = {
  field: string;
  direction: "asc" | "desc";
};

export type QueryRequest = {
  filters?: QueryRequestFilter[];
  sorts?: QueryRequestSort[];
  limit?: number;
  offset?: number;
};

export type QueryBuildResult = {
  sql: string;
  binds: Record<string, any>;
};

const SUPPORTED_OPERATORS = ["eq", "in", "contains", "gte", "lte"] as const;

export function quoteIdentifier(identifier: string): string {
  if (identifier.includes('"') || identifier.includes('\0')) {
    throw new Error(`Invalid Oracle identifier: cannot contain double quotes or null bytes.`);
  }
  return `"${identifier}"`;
}

export function buildSelectQuery(contract: ResolvedApiContract, request: QueryRequest): QueryBuildResult {
  if (contract.source.type !== "table" && contract.source.type !== "view") {
    throw new Error("Query builder only supports table or view backed contracts.");
  }

  const readableFields = contract.fields.filter(f => f.writeOnly !== true);
  if (readableFields.length === 0) {
    throw new Error("Contract has no readable fields.");
  }

  const fieldMap = new Map(readableFields.map(f => [f.apiField, f]));
  const allFieldMap = new Map(contract.fields.map(f => [f.apiField, f]));

  const selectCols = readableFields.map(f => quoteIdentifier(f.dbColumn!));
  
  const owner = contract.source.owner;
  const name = contract.source.name;
  if (!name) {
    throw new Error("Source name is required for tables and views.");
  }

  const fromClause = `${quoteIdentifier(owner)}.${quoteIdentifier(name)}`;
  
  const binds: Record<string, any> = {};
  const whereClauses: string[] = [];
  let bindIndex = 1;

  if (request.filters) {
    for (const filter of request.filters) {
      if (!fieldMap.has(filter.field)) {
        throw new Error(`Unknown filter field: ${filter.field}`);
      }
      
      const dbCol = fieldMap.get(filter.field)!.dbColumn!;

      if (!SUPPORTED_OPERATORS.includes(filter.operator as any)) {
        throw new Error(`Unsupported filter operator: ${filter.operator}`);
      }

      const bindKey = `p${bindIndex++}`;

      switch (filter.operator) {
        case "eq":
          whereClauses.push(`${quoteIdentifier(dbCol)} = :${bindKey}`);
          binds[bindKey] = filter.value;
          break;
        case "in":
          if (!Array.isArray(filter.value) || filter.value.length === 0) {
            throw new Error(`Filter operator 'in' requires a non-empty array for field ${filter.field}`);
          }
          const inKeys = filter.value.map((v, i) => {
            const k = `${bindKey}_${i}`;
            binds[k] = v;
            return `:${k}`;
          });
          whereClauses.push(`${quoteIdentifier(dbCol)} IN (${inKeys.join(", ")})`);
          break;
        case "contains":
          whereClauses.push(`${quoteIdentifier(dbCol)} LIKE :${bindKey} ESCAPE '\\'`);
          binds[bindKey] = `%${String(filter.value).replace(/[%_]/g, "\\$&")}%`;
          break;
        case "gte":
          whereClauses.push(`${quoteIdentifier(dbCol)} >= :${bindKey}`);
          binds[bindKey] = filter.value;
          break;
        case "lte":
          whereClauses.push(`${quoteIdentifier(dbCol)} <= :${bindKey}`);
          binds[bindKey] = filter.value;
          break;
      }
    }
  }

  let sorts = request.sorts;
  if (!sorts || sorts.length === 0) {
    if (contract.sorts && contract.sorts.length > 0) {
      sorts = contract.sorts.map(s => ({
        field: s.field,
        direction: s.directions?.[0] || "asc"
      }));
    }
  }

  const orderByClauses: string[] = [];
  if (sorts) {
    for (const sort of sorts) {
      if (!fieldMap.has(sort.field)) {
        throw new Error(`Unknown sort field: ${sort.field}`);
      }
      if (sort.direction !== "asc" && sort.direction !== "desc") {
        throw new Error(`Invalid sort direction: ${sort.direction}. Must be 'asc' or 'desc'.`);
      }
      const dbCol = fieldMap.get(sort.field)!.dbColumn!;
      orderByClauses.push(`${quoteIdentifier(dbCol)} ${sort.direction === "desc" ? "DESC" : "ASC"}`);
    }
  }

  let sql = `SELECT ${selectCols.join(", ")} FROM ${fromClause}`;
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }
  if (orderByClauses.length > 0) {
    sql += ` ORDER BY ${orderByClauses.join(", ")}`;
  }

  // Pagination with offset/fetch (Oracle 12c+)
  if (request.limit !== undefined) {
    if (request.offset !== undefined) {
      sql += ` OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;
      binds.offset = request.offset;
      binds.limit = request.limit;
    } else {
      sql += ` FETCH FIRST :limit ROWS ONLY`;
      binds.limit = request.limit;
    }
  }

  return { sql, binds };
}
