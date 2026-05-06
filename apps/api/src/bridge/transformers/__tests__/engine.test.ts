import { describe, expect, it } from "vitest";
import { transformReadValue, transformWriteValue } from "../engine.js";
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
      // no trimRight transformer
    };
    
    // Space is preserved because there's no trimRight transformer
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

  it("8. null handling follows nullable config", () => {
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

    // Nullable is allowed
    expect(transformReadValue(null, nullableField)).toBe(null);
    expect(transformWriteValue(null, nullableField)).toBe(null);

    // Required throws
    expect(() => transformReadValue(null, requiredField)).toThrowError("Field requiredData cannot be null.");
    expect(() => transformWriteValue(null, requiredField)).toThrowError("Field requiredData cannot be null.");
  });

  it("DATE/TIMESTAMP normalization to API date-time string on read", () => {
    const dateField: ApiFieldMapping = {
      apiField: "createdAt",
      apiType: "date-time",
      oracleType: "timestamp"
    };

    const date = new Date("2026-05-06T10:00:00Z");
    
    // Read: Date -> ISO string
    expect(transformReadValue(date, dateField)).toBe("2026-05-06T10:00:00.000Z");

    // Read: ISO string -> ISO string
    expect(transformReadValue("2026-05-06T10:00:00.000Z", dateField)).toBe("2026-05-06T10:00:00.000Z");

    // Write: ISO string -> Date
    expect(transformWriteValue("2026-05-06T10:00:00.000Z", dateField)).toEqual(date);
  });
});
