import type { ApiFieldMapping } from "../contracts/index.js";

export function transformReadValue(value: unknown, field: ApiFieldMapping): unknown {
  if (value === null || value === undefined) {
    if (field.nullable === false) {
      throw new Error(`Field ${field.apiField} cannot be null.`);
    }
    return null;
  }

  let result = value;

  // 2. Oracle type normalization (raw Oracle value -> normalized)
  if (field.oracleType === "date" || field.oracleType === "timestamp") {
    if (result instanceof Date) {
      result = result.toISOString();
    } else if (typeof result === "string") {
      const parsed = new Date(result);
      if (!isNaN(parsed.getTime())) {
        result = parsed.toISOString();
      }
    }
  }

  // 3. configured transformer
  if (field.transformers) {
    for (const transformer of field.transformers) {
      if (transformer.kind === "trimRight") {
        if (typeof result === "string") {
          result = result.trimEnd();
        }
      } else if (transformer.kind === "booleanMapping") {
        if (result === transformer.trueValue) {
          result = true;
        } else if (result === transformer.falseValue) {
          result = false;
        }
      }
    }
  }

  return result;
}

export function transformWriteValue(value: unknown, field: ApiFieldMapping): unknown {
  if (value === null || value === undefined) {
    if (field.nullable === false) {
      throw new Error(`Field ${field.apiField} cannot be null.`);
    }
    return null;
  }

  let result = value;

  // 1. API value validation & 2. configured transformer
  if (field.transformers) {
    // Reverse boolean mapping for writes
    for (const transformer of field.transformers) {
      if (transformer.kind === "booleanMapping") {
        if (result === true) {
          result = transformer.trueValue;
        } else if (result === false) {
          result = transformer.falseValue;
        }
      }
      // trimRight doesn't do anything on write
    }
  }

  // 3. Oracle bind value (ensure dates are sent as Date objects to the adapter)
  if (field.oracleType === "date" || field.oracleType === "timestamp") {
    if (typeof result === "string") {
      const parsed = new Date(result);
      if (!isNaN(parsed.getTime())) {
        result = parsed;
      }
    }
  }

  return result;
}
