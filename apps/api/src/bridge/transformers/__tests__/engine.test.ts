import { describe, expect, it } from "vitest";
import { transformReadValue, transformWriteValue, applyReadPermissionMask } from "../engine.js";
import type { ApiFieldMapping } from "../../contracts/index.js";

describe("Type Transformer Engine", () => {
  it("1. CHAR value 'ACTIVE   ' maps to 'ACTIVE'", () => {
    const field: ApiFieldMapping = {
      apiField: "status",
      apiType: "string",
      oracleType: "char",
      transformers: [{ kind: "trimRight", oracleType: "char" }]
    };
    expect(transformReadValue("ACTIVE   ", field)).toBe("ACTIVE");
  });

  it("2. VARCHAR2 value is not trimmed unexpectedly", () => {
    const field: ApiFieldMapping = {
      apiField: "description",
      apiType: "string",
      oracleType: "varchar2"
    };
    expect(transformReadValue("Notes   ", field)).toBe("Notes   ");
  });

  it("3. 'Y' maps to true", () => {
    const field: ApiFieldMapping = {
      apiField: "isActive",
      apiType: "boolean",
      oracleType: "char",
      transformers: [{ kind: "booleanMapping", oracleType: "char", trueValue: "Y", falseValue: "N" }]
    };
    expect(transformReadValue("Y", field)).toBe(true);
  });

  it("4. 'N' maps to false", () => {
    const field: ApiFieldMapping = {
      apiField: "isActive",
      apiType: "boolean",
      oracleType: "char",
      transformers: [{ kind: "booleanMapping", oracleType: "char", trueValue: "Y", falseValue: "N" }]
    };
    expect(transformReadValue("N", field)).toBe(false);
  });

  it("5. true maps to 'Y' on write", () => {
    const field: ApiFieldMapping = {
      apiField: "isActive",
      apiType: "boolean",
      oracleType: "char",
      transformers: [{ kind: "booleanMapping", oracleType: "char", trueValue: "Y", falseValue: "N" }]
    };
    expect(transformWriteValue(true, field)).toBe("Y");
  });

  it("6. false maps to 'N' on write", () => {
    const field: ApiFieldMapping = {
      apiField: "isActive",
      apiType: "boolean",
      oracleType: "char",
      transformers: [{ kind: "booleanMapping", oracleType: "char", trueValue: "Y", falseValue: "N" }]
    };
    expect(transformWriteValue(false, field)).toBe("N");
  });

  it("7. 1/0 maps to boolean", () => {
    const field: ApiFieldMapping = {
      apiField: "isDeleted",
      apiType: "boolean",
      oracleType: "number",
      transformers: [{ kind: "booleanMapping", oracleType: "number", trueValue: 1, falseValue: 0 }]
    };
    expect(transformReadValue(1, field)).toBe(true);
    expect(transformReadValue(0, field)).toBe(false);
    expect(transformWriteValue(true, field)).toBe(1);
    expect(transformWriteValue(false, field)).toBe(0);
  });

  it("8. DATE/TIMESTAMP normalization to API date-time string on read", () => {
    const dateField: ApiFieldMapping = {
      apiField: "createdAt",
      apiType: "date-time",
      oracleType: "timestamp"
    };
    const date = new Date("2026-05-06T10:00:00Z");
    expect(transformReadValue(date, dateField)).toBe("2026-05-06T10:00:00.000Z");
    expect(transformReadValue("2026-05-06T10:00:00.000Z", dateField)).toBe("2026-05-06T10:00:00.000Z");
    expect(transformWriteValue("2026-05-06T10:00:00.000Z", dateField)).toEqual(date);
  });

  it("9. null handling follows nullable config", () => {
    const nullableField: ApiFieldMapping = {
      apiField: "optionalData",
      apiType: "string",
      oracleType: "varchar2",
      nullable: true
    };
    const requiredField: ApiFieldMapping = {
      apiField: "requiredData",
      apiType: "string",
      oracleType: "varchar2",
      nullable: false
    };

    expect(transformReadValue(null, nullableField)).toBe(null);
    expect(transformWriteValue(null, nullableField)).toBe(null);
    expect(() => transformReadValue(null, requiredField)).toThrowError("Field requiredData cannot be null.");
    expect(() => transformWriteValue(null, requiredField)).toThrowError("Field requiredData cannot be null.");
  });

  it("10. unmapped nullable boolean DB value maps to null", () => {
    const field: ApiFieldMapping = {
      apiField: "isActive",
      apiType: "boolean",
      oracleType: "char",
      nullable: true,
      transformers: [{ kind: "booleanMapping", oracleType: "char", trueValue: "Y", falseValue: "N" }]
    };

    expect(transformReadValue("X", field)).toBe(null);
  });

  it("11. unmapped required boolean DB value is rejected", () => {
    const field: ApiFieldMapping = {
      apiField: "isActive",
      apiType: "boolean",
      oracleType: "char",
      nullable: false,
      transformers: [{ kind: "booleanMapping", oracleType: "char", trueValue: "Y", falseValue: "N" }]
    };

    expect(() => transformReadValue("X", field)).toThrowError("Field isActive has an unmapped boolean value.");
  });

  describe("Write API type validation", () => {
    const boolField: ApiFieldMapping = { apiField: "active", apiType: "boolean", oracleType: "char",
      transformers: [{ kind: "booleanMapping", oracleType: "char", trueValue: "Y", falseValue: "N" }]
    };
    const strField: ApiFieldMapping  = { apiField: "name",   apiType: "string",  oracleType: "varchar2" };
    const numField: ApiFieldMapping  = { apiField: "salary", apiType: "number",  oracleType: "number"  };
    const intField: ApiFieldMapping  = { apiField: "age",    apiType: "integer", oracleType: "number"  };

    it("rejects string 'true' for boolean field", () => {
      expect(() => transformWriteValue("true", boolField)).toThrowError("expects a boolean");
    });

    it("rejects string 'Y' for boolean field", () => {
      expect(() => transformWriteValue("Y", boolField)).toThrowError("expects a boolean");
    });

    it("rejects number 1 for boolean field", () => {
      expect(() => transformWriteValue(1, boolField)).toThrowError("expects a boolean");
    });

    it("rejects object for boolean field", () => {
      expect(() => transformWriteValue({}, boolField)).toThrowError("expects a boolean");
    });

    it("rejects number for string field", () => {
      expect(() => transformWriteValue(42, strField)).toThrowError("expects a string");
    });

    it("rejects string for number field", () => {
      expect(() => transformWriteValue("42", numField)).toThrowError("expects a number");
    });

    it("rejects float for integer field", () => {
      expect(() => transformWriteValue(3.14, intField)).toThrowError("expects an integer");
    });

    it("rejects invalid date string", () => {
      const dateField: ApiFieldMapping = { apiField: "dob", apiType: "date", oracleType: "date" };
      expect(() => transformWriteValue("not-a-date", dateField)).toThrowError("invalid date");
    });

    it("accepts valid date string", () => {
      const dateField: ApiFieldMapping = { apiField: "dob", apiType: "date", oracleType: "date" };
      expect(() => transformWriteValue("2026-01-01", dateField)).not.toThrow();
    });

    it("rejects array for object field", () => {
      const objField: ApiFieldMapping = { apiField: "meta", apiType: "object", oracleType: "clob" };
      expect(() => transformWriteValue([1, 2], objField)).toThrowError("expects a plain object");
    });

    it("accepts plain object for object field", () => {
      const objField: ApiFieldMapping = { apiField: "meta", apiType: "object", oracleType: "clob" };
      expect(() => transformWriteValue({ key: "val" }, objField)).not.toThrow();
    });

    it("rejects string for array field", () => {
      const arrField: ApiFieldMapping = { apiField: "tags", apiType: "array", oracleType: "clob" };
      expect(() => transformWriteValue("not-an-array", arrField)).toThrowError("expects an array");
    });

    it("accepts array for array field", () => {
      const arrField: ApiFieldMapping = { apiField: "tags", apiType: "array", oracleType: "clob" };
      expect(() => transformWriteValue(["a", "b"], arrField)).not.toThrow();
    });

    it("rejects number for binary field", () => {
      const binField: ApiFieldMapping = { apiField: "avatar", apiType: "binary", oracleType: "blob" };
      expect(() => transformWriteValue(12345, binField)).toThrowError("expects a base64 string or Buffer");
    });

    it("accepts string for binary field", () => {
      const binField: ApiFieldMapping = { apiField: "avatar", apiType: "binary", oracleType: "blob" };
      expect(() => transformWriteValue("aGVsbG8=", binField)).not.toThrow();
    });
  });

  describe("Read permission masking (step 4)", () => {
    const field: ApiFieldMapping = { apiField: "salary", apiType: "number", oracleType: "number" };

    it("returns value when field is in allowedFields", () => {
      const allowed = new Set(["salary"]);
      expect(applyReadPermissionMask(50000, field, allowed)).toBe(50000);
    });

    it("returns undefined when field is NOT in allowedFields", () => {
      const allowed = new Set(["name"]);
      expect(applyReadPermissionMask(50000, field, allowed)).toBeUndefined();
    });

    it("returns value when allowedFields is undefined (no restriction)", () => {
      expect(applyReadPermissionMask(50000, field, undefined)).toBe(50000);
    });
  });
});
