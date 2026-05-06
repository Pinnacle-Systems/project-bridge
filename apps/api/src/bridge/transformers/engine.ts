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

/**
 * Step 4 of the read mapping order: permission masking/hiding.
 * Returns undefined for fields absent from allowedFields.
 * Callers should omit undefined-valued keys before serialising to JSON.
 */
export function applyReadPermissionMask(
  value: unknown,
  field: ApiFieldMapping,
  allowedFields: ReadonlySet<string> | undefined
): unknown {
  if (allowedFields !== undefined && !allowedFields.has(field.apiField)) {
    return undefined;
  }
  return value;
}

export function transformWriteValue(value: unknown, field: ApiFieldMapping): unknown {
  if (value === null || value === undefined) {
    if (field.nullable === false) {
      throw new Error(`Field ${field.apiField} cannot be null.`);
    }
    return null;
  }

  // 1. API value validation — reject values that don't match field.apiType
  validateApiType(value, field);

  let result = value;

  // 2. configured transformer (reverse boolean mapping for writes)
  if (field.transformers) {
    for (const transformer of field.transformers) {
      if (transformer.kind === "booleanMapping") {
        if (result === true) {
          result = transformer.trueValue;
        } else if (result === false) {
          result = transformer.falseValue;
        }
      }
      // trimRight is read-only; no write transformation needed
    }
  }

  // 3. Oracle bind value — ensure dates are sent as Date objects to the adapter
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

function validateApiType(value: unknown, field: ApiFieldMapping): void {
  const { apiType, apiField } = field;

  switch (apiType) {
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(`Field ${apiField} expects a boolean, got ${typeof value}.`);
      }
      break;
    case "number":
    case "decimal":
    case "integer":
      if (typeof value !== "number") {
        throw new Error(`Field ${apiField} expects a number, got ${typeof value}.`);
      }
      if (apiType === "integer" && !Number.isInteger(value)) {
        throw new Error(`Field ${apiField} expects an integer.`);
      }
      break;
    case "string":
      if (typeof value !== "string") {
        throw new Error(`Field ${apiField} expects a string, got ${typeof value}.`);
      }
      break;
    case "date":
    case "date-time":
      if (!(value instanceof Date) && typeof value !== "string") {
        throw new Error(`Field ${apiField} expects a date string or Date object, got ${typeof value}.`);
      }
      if (typeof value === "string" && isNaN(Date.parse(value))) {
        throw new Error(`Field ${apiField} has an invalid date value.`);
      }
      break;
    case "object":
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Field ${apiField} expects a plain object.`);
      }
      break;
    case "array":
      if (!Array.isArray(value)) {
        throw new Error(`Field ${apiField} expects an array.`);
      }
      break;
    case "binary":
      if (typeof value !== "string" && !Buffer.isBuffer(value)) {
        throw new Error(`Field ${apiField} expects a base64 string or Buffer.`);
      }
      break;
  }
}
